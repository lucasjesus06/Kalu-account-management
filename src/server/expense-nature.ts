import "server-only";
import { and, eq, inArray, notInArray, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getDb } from "@/db/client";
import {
  categories,
  expenseNatureRules,
  householdMembers,
  householdSharedAccounts,
  transactions,
} from "@/db/schema";
import {
  expenseNatureLabel,
  parseExpenseChoice,
  resolveExpenseNature,
  type ExpenseAssignment,
} from "@/domain/expense-nature";
import { UUID_PATTERN, type ActionResult } from "./connections";
import type { CorrectionScope } from "./categorization";
import { listHouseholdMembers } from "./profiles";
import { accountVisibleTo, ownedAccountIds } from "./scope";
import { recordChange } from "./change-log";

type Db = ReturnType<typeof getDb>;
type Executor = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

const CHUNK_SIZE = 500;

export const expenseMembers = alias(householdMembers, "expense_members");

export const expenseSelection = {
  expenseNature: transactions.expenseNature,
  expenseMemberId: transactions.expenseMemberId,
  expenseMemberName: expenseMembers.displayName,
  expenseNatureSource: transactions.expenseNatureSource,
};

export const joinExpenseMember = eq(expenseMembers.id, transactions.expenseMemberId);

export async function loadExpenseNatureRules(db: Executor, householdId: string) {
  const rows = await db
    .select({
      merchantName: expenseNatureRules.merchantName,
      nature: expenseNatureRules.expenseNature,
      memberId: expenseNatureRules.expenseMemberId,
    })
    .from(expenseNatureRules)
    .where(eq(expenseNatureRules.householdId, householdId));
  return new Map<string, ExpenseAssignment>(rows.map((row) => [row.merchantName, { nature: row.nature, memberId: row.memberId }]));
}

export async function refreshExpenseNature(db: Executor, scope: SQL, rules: ReadonlyMap<string, ExpenseAssignment>) {
  const rows = await db
    .select({
      id: transactions.id,
      merchantName: transactions.merchantName,
      nature: transactions.expenseNature,
      memberId: transactions.expenseMemberId,
      source: transactions.expenseNatureSource,
      categorySlug: categories.slug,
      categoryKind: categories.kind,
    })
    .from(transactions)
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .where(and(scope, sql`${transactions.expenseNatureSource} is distinct from 'user'`));

  const changed = rows.flatMap((row) => {
    const resolved = resolveExpenseNature(
      {
        merchantName: row.merchantName,
        category: row.categorySlug && row.categoryKind ? { slug: row.categorySlug, kind: row.categoryKind } : null,
      },
      rules,
    );
    const next = {
      nature: resolved?.assignment.nature ?? null,
      memberId: resolved?.assignment.memberId ?? null,
      source: resolved?.source ?? ("automatic" as const),
    };
    const same = next.nature === row.nature && next.memberId === row.memberId && next.source === row.source;
    return same ? [] : [{ id: row.id, ...next }];
  });

  for (let start = 0; start < changed.length; start += CHUNK_SIZE) {
    const values = changed
      .slice(start, start + CHUNK_SIZE)
      .map((row) => sql`(${row.id}::uuid, ${row.nature}::text, ${row.memberId}::uuid, ${row.source}::text)`);
    await db.execute(sql`
      update ${transactions}
      set expense_nature = v.expense_nature, expense_member_id = v.expense_member_id, expense_nature_source = v.expense_nature_source, updated_at = now()
      from (values ${sql.join(values, sql`, `)}) as v(id, expense_nature, expense_member_id, expense_nature_source)
      where ${transactions.id} = v.id
    `);
  }
  return changed.length;
}

export type Editor = { memberId: string; householdId: string | null };

export async function refreshEditableExpenseNature(db: Executor, editor: Editor, scope: SQL) {
  const rules = editor.householdId ? await loadExpenseNatureRules(db, editor.householdId) : new Map<string, ExpenseAssignment>();
  return refreshExpenseNature(db, and(scope, accountVisibleTo(editor.memberId, transactions.accountId))!, rules);
}

export async function refreshOwnedExpenseNature(db: Executor, memberId: string, scope: SQL) {
  const owned = and(scope, inArray(transactions.accountId, ownedAccountIds(memberId)))!;
  const links = await db
    .selectDistinct({ householdId: householdSharedAccounts.householdId })
    .from(householdSharedAccounts)
    .where(inArray(householdSharedAccounts.accountId, ownedAccountIds(memberId)));
  let changed = 0;
  for (const { householdId } of links) {
    const sharedIds = db
      .select({ id: householdSharedAccounts.accountId })
      .from(householdSharedAccounts)
      .where(eq(householdSharedAccounts.householdId, householdId));
    changed += await refreshExpenseNature(db, and(owned, inArray(transactions.accountId, sharedIds))!, await loadExpenseNatureRules(db, householdId));
  }
  const allShared = db.select({ id: householdSharedAccounts.accountId }).from(householdSharedAccounts);
  return changed + (await refreshExpenseNature(db, and(owned, notInArray(transactions.accountId, allShared))!, new Map()));
}

function countLabel(count: number) {
  return count === 0 ? "nenhuma transação anterior" : count === 1 ? "1 transação anterior" : `${count} transações anteriores`;
}

export async function correctExpenseNature(
  member: Editor,
  transactionId: string,
  choice: string,
  scope: CorrectionScope,
): Promise<ActionResult> {
  if (!UUID_PATTERN.test(transactionId)) {
    return { ok: false, error: "Transação inválida." };
  }
  if (!member.householdId) {
    return { ok: false, error: "Para quem o gasto é só definido dentro de uma residência." };
  }
  const householdId = member.householdId;

  const db = getDb();
  const members = await listHouseholdMembers(householdId);
  const assignment = parseExpenseChoice(
    choice,
    members.map((m) => m.id),
  );
  if (assignment === undefined) {
    return { ok: false, error: "Escolha para quem é o gasto." };
  }
  if (assignment === null && scope !== "transaction") {
    return { ok: false, error: "Escolha para quem é o gasto para criar uma regra." };
  }

  const [transaction] = await db
    .select({
      id: transactions.id,
      merchantName: transactions.merchantName,
      description: transactions.description,
      expenseNature: transactions.expenseNature,
      expenseMemberId: transactions.expenseMemberId,
    })
    .from(transactions)
    .where(and(eq(transactions.id, transactionId), accountVisibleTo(member.memberId, transactions.accountId)));
  if (!transaction) {
    return { ok: false, error: "Transação não encontrada." };
  }

  const merchant = transaction.merchantName ?? transaction.description;
  const label = expenseNatureLabel({
    nature: assignment?.nature ?? null,
    memberId: assignment?.memberId ?? null,
    memberName: members.find((m) => m.id === assignment?.memberId)?.displayName ?? null,
  });

  const previousLabel = expenseNatureLabel({
    nature: transaction.expenseNature,
    memberId: transaction.expenseMemberId,
    memberName: members.find((m) => m.id === transaction.expenseMemberId)?.displayName ?? null,
  });
  const logChange = (executor: Parameters<typeof recordChange>[0], affectedCount: number) =>
    recordChange(executor, {
      householdId,
      memberId: member.memberId,
      kind: "expense_changed",
      subject: merchant,
      scope,
      previousValue: previousLabel,
      newValue: label,
      affectedCount,
    });

  if (scope === "transaction") {
    await db.transaction(async (tx) => {
      await tx
        .update(transactions)
        .set({
          expenseNature: assignment?.nature ?? null,
          expenseMemberId: assignment?.memberId ?? null,
          expenseNatureSource: "user",
          updatedAt: new Date(),
        })
        .where(eq(transactions.id, transaction.id));
      await logChange(tx, 1);
    });
    return { ok: true, message: `Para quem alterado para ${label} somente nesta transação.` };
  }

  const rule = assignment!;
  const updatedHistory = await db.transaction(async (tx) => {
    await tx
      .insert(expenseNatureRules)
      .values({
        householdId,
        merchantName: merchant,
        expenseNature: rule.nature,
        expenseMemberId: rule.memberId,
        createdByMemberId: member.memberId,
      })
      .onConflictDoUpdate({
        target: [expenseNatureRules.householdId, expenseNatureRules.merchantName],
        set: {
          expenseNature: rule.nature,
          expenseMemberId: rule.memberId,
          createdByMemberId: member.memberId,
          updatedAt: new Date(),
        },
      });

    const values = { expenseNature: rule.nature, expenseMemberId: rule.memberId, expenseNatureSource: "rule" as const };
    await tx
      .update(transactions)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(transactions.id, transaction.id));

    if (scope !== "merchant_history") {
      await logChange(tx, 1);
      return 0;
    }
    const updated = await tx
      .update(transactions)
      .set({ ...values, updatedAt: new Date() })
      .where(
        and(
          eq(transactions.merchantName, merchant),
          accountVisibleTo(member.memberId, transactions.accountId),
          sql`${transactions.expenseNatureSource} is distinct from 'user'`,
          sql`(${transactions.expenseNature}, ${transactions.expenseMemberId}, ${transactions.expenseNatureSource}) is distinct from (${rule.nature}::text, ${rule.memberId}::uuid, 'rule'::text)`,
        ),
      )
      .returning({ id: transactions.id });
    await logChange(tx, updated.length + 1);
    return updated.length;
  });

  if (scope === "merchant") {
    return {
      ok: true,
      message: `Para quem alterado para ${label}. As próximas transações de ${merchant} também serão marcadas assim.`,
    };
  }
  return {
    ok: true,
    message: `Para quem alterado para ${label} em ${merchant}, incluindo ${countLabel(updatedHistory)}. Ajustes feitos só numa transação foram mantidos.`,
  };
}
