import "server-only";
import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getDb } from "@/db/client";
import {
  categories,
  expenseNatureRules,
  financialAccounts,
  householdMembers,
  integrationConnections,
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

export function householdAccountIds(householdId: string) {
  return getDb()
    .select({ id: financialAccounts.id })
    .from(financialAccounts)
    .innerJoin(integrationConnections, eq(integrationConnections.id, financialAccounts.connectionId))
    .innerJoin(householdMembers, eq(householdMembers.id, integrationConnections.memberId))
    .where(eq(householdMembers.householdId, householdId));
}

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

export async function refreshHouseholdExpenseNature(db: Executor, householdId: string, scope: SQL) {
  const rules = await loadExpenseNatureRules(db, householdId);
  return refreshExpenseNature(db, and(scope, inArray(transactions.accountId, householdAccountIds(householdId)))!, rules);
}

function countLabel(count: number) {
  return count === 0 ? "nenhuma transação anterior" : count === 1 ? "1 transação anterior" : `${count} transações anteriores`;
}

export async function correctExpenseNature(
  member: { memberId: string; householdId: string },
  transactionId: string,
  choice: string,
  scope: CorrectionScope,
): Promise<ActionResult> {
  if (!UUID_PATTERN.test(transactionId)) {
    return { ok: false, error: "Transação inválida." };
  }

  const db = getDb();
  const members = await db
    .select({ id: householdMembers.id, displayName: householdMembers.displayName })
    .from(householdMembers)
    .where(eq(householdMembers.householdId, member.householdId));
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
    .select({ id: transactions.id, merchantName: transactions.merchantName, description: transactions.description })
    .from(transactions)
    .where(and(eq(transactions.id, transactionId), inArray(transactions.accountId, householdAccountIds(member.householdId))));
  if (!transaction) {
    return { ok: false, error: "Transação não encontrada." };
  }

  const merchant = transaction.merchantName ?? transaction.description;
  const label = expenseNatureLabel({
    nature: assignment?.nature ?? null,
    memberId: assignment?.memberId ?? null,
    memberName: members.find((m) => m.id === assignment?.memberId)?.displayName ?? null,
  });

  if (scope === "transaction") {
    await db
      .update(transactions)
      .set({
        expenseNature: assignment?.nature ?? null,
        expenseMemberId: assignment?.memberId ?? null,
        expenseNatureSource: "user",
        updatedAt: new Date(),
      })
      .where(eq(transactions.id, transaction.id));
    return { ok: true, message: `Para quem alterado para ${label} somente nesta transação.` };
  }

  const rule = assignment!;
  const updatedHistory = await db.transaction(async (tx) => {
    await tx
      .insert(expenseNatureRules)
      .values({
        householdId: member.householdId,
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
      return 0;
    }
    const updated = await tx
      .update(transactions)
      .set({ ...values, updatedAt: new Date() })
      .where(
        and(
          eq(transactions.merchantName, merchant),
          inArray(transactions.accountId, householdAccountIds(member.householdId)),
          sql`${transactions.expenseNatureSource} is distinct from 'user'`,
          sql`(${transactions.expenseNature}, ${transactions.expenseMemberId}, ${transactions.expenseNatureSource}) is distinct from (${rule.nature}::text, ${rule.memberId}::uuid, 'rule'::text)`,
        ),
      )
      .returning({ id: transactions.id });
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
