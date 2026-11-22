import "server-only";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { categories, categoryRules, expenseNatureRules, householdMembers, householdMemberships, transactions } from "@/db/schema";
import { expenseChoiceOf, expenseNatureLabel, parseExpenseChoice } from "@/domain/expense-nature";
import { householdScope } from "@/domain/scope";
import { recordChange } from "./change-log";
import { UUID_PATTERN, type ActionResult } from "./connections";
import { refreshExpenseNature, loadExpenseNatureRules } from "./expense-nature";
import { listHouseholdMembers } from "./profiles";
import { scopeAccountIds } from "./scope";

export const RULE_MERCHANT_MAX = 120;

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

async function isMember(memberId: string, householdId: string) {
  if (!UUID_PATTERN.test(householdId)) {
    return false;
  }
  const [row] = await getDb()
    .select({ id: householdMemberships.id })
    .from(householdMemberships)
    .where(and(eq(householdMemberships.householdId, householdId), eq(householdMemberships.memberId, memberId)));
  return Boolean(row);
}

function parseMerchant(value: unknown) {
  const merchant = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  return merchant.length > 0 && merchant.length <= RULE_MERCHANT_MAX ? merchant : null;
}

const countLabel = (count: number) => (count === 1 ? "1 transação" : `${count} transações`);

export async function listRules(householdId: string) {
  const db = getDb();
  const [category, nature, members] = await Promise.all([
    db
      .select({
        id: categoryRules.id,
        merchantName: categoryRules.merchantName,
        categoryId: categoryRules.categoryId,
        categoryName: categories.name,
        updatedAt: categoryRules.updatedAt,
        createdBy: householdMembers.displayName,
      })
      .from(categoryRules)
      .innerJoin(categories, eq(categories.id, categoryRules.categoryId))
      .leftJoin(householdMembers, eq(householdMembers.id, categoryRules.createdByMemberId))
      .where(eq(categoryRules.householdId, householdId))
      .orderBy(asc(categoryRules.merchantName)),
    db
      .select({
        id: expenseNatureRules.id,
        merchantName: expenseNatureRules.merchantName,
        nature: expenseNatureRules.expenseNature,
        memberId: expenseNatureRules.expenseMemberId,
        updatedAt: expenseNatureRules.updatedAt,
        createdBy: householdMembers.displayName,
      })
      .from(expenseNatureRules)
      .leftJoin(householdMembers, eq(householdMembers.id, expenseNatureRules.createdByMemberId))
      .where(eq(expenseNatureRules.householdId, householdId))
      .orderBy(asc(expenseNatureRules.merchantName)),
    listHouseholdMembers(householdId),
  ]);

  return {
    category,
    nature: nature.map((rule) => ({
      ...rule,
      choice: expenseChoiceOf({ nature: rule.nature, memberId: rule.memberId }),
      label: expenseNatureLabel({
        nature: rule.nature,
        memberId: rule.memberId,
        memberName: members.find((m) => m.id === rule.memberId)?.displayName ?? null,
      }),
    })),
    members,
  };
}

export async function listKnownMerchants(householdId: string, limit = 200) {
  const rows = await getDb()
    .select({ merchantName: transactions.merchantName, total: sql<number>`count(*)`.mapWith(Number) })
    .from(transactions)
    .where(
      and(
        inArray(transactions.accountId, scopeAccountIds(householdScope(householdId))),
        sql`${transactions.merchantName} is not null`,
      ),
    )
    .groupBy(transactions.merchantName)
    .orderBy(desc(sql`count(*)`), asc(transactions.merchantName))
    .limit(limit);
  return rows.flatMap((row) => (row.merchantName ? [row.merchantName] : []));
}

function logRule(tx: Tx, entry: { householdId: string; memberId: string; kind: "rule_saved" | "rule_removed"; merchant: string; detail: string; count?: number }) {
  return recordChange(tx, {
    householdId: entry.householdId,
    memberId: entry.memberId,
    kind: entry.kind,
    subject: entry.merchant,
    previousValue: entry.kind === "rule_removed" ? entry.detail : null,
    newValue: entry.kind === "rule_saved" ? entry.detail : null,
    affectedCount: entry.count ?? 1,
  });
}

export async function saveCategoryRule(
  memberId: string,
  householdId: string,
  rawMerchant: unknown,
  categoryId: string,
  applyHistory: boolean,
): Promise<ActionResult> {
  const merchant = parseMerchant(rawMerchant);
  if (!merchant) {
    return { ok: false, error: "Informe o estabelecimento, como aparece nas transações." };
  }
  if (!UUID_PATTERN.test(categoryId)) {
    return { ok: false, error: "Escolha uma categoria." };
  }
  if (!(await isMember(memberId, householdId))) {
    return { ok: false, error: "Você não participa desta residência." };
  }

  const db = getDb();
  const [category] = await db.select({ id: categories.id, name: categories.name }).from(categories).where(eq(categories.id, categoryId));
  if (!category) {
    return { ok: false, error: "Categoria não encontrada." };
  }

  const updated = await db.transaction(async (tx) => {
    await tx
      .insert(categoryRules)
      .values({ householdId, merchantName: merchant, categoryId, createdByMemberId: memberId })
      .onConflictDoUpdate({
        target: [categoryRules.householdId, categoryRules.merchantName],
        set: { categoryId, createdByMemberId: memberId, updatedAt: new Date() },
      });
    const changed = applyHistory
      ? await tx
          .update(transactions)
          .set({ categoryId, categorySource: "rule", updatedAt: new Date() })
          .where(
            and(
              eq(transactions.merchantName, merchant),
              inArray(transactions.accountId, scopeAccountIds(householdScope(householdId))),
              sql`${transactions.categorySource} is distinct from 'user'`,
              sql`${transactions.categoryId} is distinct from ${categoryId}`,
            ),
          )
          .returning({ id: transactions.id })
      : [];
    await logRule(tx, { householdId, memberId, kind: "rule_saved", merchant, detail: `Categoria: ${category.name}`, count: changed.length + 1 });
    return changed.length;
  });

  if (applyHistory) {
    const rules = await loadExpenseNatureRules(db, householdId);
    await refreshExpenseNature(db, and(eq(transactions.merchantName, merchant), inArray(transactions.accountId, scopeAccountIds(householdScope(householdId))))!, rules);
  }
  return {
    ok: true,
    message: applyHistory
      ? `Regra salva: ${merchant} vira ${category.name}, incluindo ${countLabel(updated)} anteriores. Ajustes feitos só numa transação foram mantidos.`
      : `Regra salva: as próximas transações de ${merchant} viram ${category.name}.`,
  };
}

export async function deleteCategoryRule(memberId: string, ruleId: string): Promise<ActionResult> {
  if (!UUID_PATTERN.test(ruleId)) {
    return { ok: false, error: "Regra inválida." };
  }
  const db = getDb();
  const [rule] = await db
    .select({ householdId: categoryRules.householdId, merchantName: categoryRules.merchantName, categoryName: categories.name })
    .from(categoryRules)
    .innerJoin(categories, eq(categories.id, categoryRules.categoryId))
    .where(eq(categoryRules.id, ruleId));
  if (!rule || !(await isMember(memberId, rule.householdId))) {
    return { ok: false, error: "Regra não encontrada." };
  }
  await db.transaction(async (tx) => {
    await tx.delete(categoryRules).where(eq(categoryRules.id, ruleId));
    await logRule(tx, { householdId: rule.householdId, memberId, kind: "rule_removed", merchant: rule.merchantName, detail: `Categoria: ${rule.categoryName}` });
  });
  return { ok: true, message: `Regra de ${rule.merchantName} removida. As transações já classificadas continuam como estão.` };
}

export async function saveNatureRule(
  memberId: string,
  householdId: string,
  rawMerchant: unknown,
  choice: string,
  applyHistory: boolean,
): Promise<ActionResult> {
  const merchant = parseMerchant(rawMerchant);
  if (!merchant) {
    return { ok: false, error: "Informe o estabelecimento, como aparece nas transações." };
  }
  if (!(await isMember(memberId, householdId))) {
    return { ok: false, error: "Você não participa desta residência." };
  }

  const db = getDb();
  const members = await listHouseholdMembers(householdId);
  const assignment = parseExpenseChoice(
    choice,
    members.map((m) => m.id),
  );
  if (!assignment) {
    return { ok: false, error: "Escolha para quem é o gasto." };
  }
  const label = expenseNatureLabel({
    nature: assignment.nature,
    memberId: assignment.memberId,
    memberName: members.find((m) => m.id === assignment.memberId)?.displayName ?? null,
  });

  const updated = await db.transaction(async (tx) => {
    await tx
      .insert(expenseNatureRules)
      .values({ householdId, merchantName: merchant, expenseNature: assignment.nature, expenseMemberId: assignment.memberId, createdByMemberId: memberId })
      .onConflictDoUpdate({
        target: [expenseNatureRules.householdId, expenseNatureRules.merchantName],
        set: { expenseNature: assignment.nature, expenseMemberId: assignment.memberId, createdByMemberId: memberId, updatedAt: new Date() },
      });
    await logRule(tx, { householdId, memberId, kind: "rule_saved", merchant, detail: `Para quem: ${label}` });
    return applyHistory
      ? refreshExpenseNature(
          tx,
          and(eq(transactions.merchantName, merchant), inArray(transactions.accountId, scopeAccountIds(householdScope(householdId))))!,
          await loadExpenseNatureRules(tx, householdId),
        )
      : 0;
  });

  return {
    ok: true,
    message: applyHistory
      ? `Regra salva: ${merchant} é ${label}, incluindo ${countLabel(updated)} anteriores. Ajustes feitos só numa transação foram mantidos.`
      : `Regra salva: as próximas transações de ${merchant} são ${label}.`,
  };
}

export async function deleteNatureRule(memberId: string, ruleId: string): Promise<ActionResult> {
  if (!UUID_PATTERN.test(ruleId)) {
    return { ok: false, error: "Regra inválida." };
  }
  const db = getDb();
  const [rule] = await db
    .select({
      householdId: expenseNatureRules.householdId,
      merchantName: expenseNatureRules.merchantName,
      nature: expenseNatureRules.expenseNature,
      memberId: expenseNatureRules.expenseMemberId,
    })
    .from(expenseNatureRules)
    .where(eq(expenseNatureRules.id, ruleId));
  if (!rule || !(await isMember(memberId, rule.householdId))) {
    return { ok: false, error: "Regra não encontrada." };
  }
  const members = await listHouseholdMembers(rule.householdId);
  const label = expenseNatureLabel({
    nature: rule.nature,
    memberId: rule.memberId,
    memberName: members.find((m) => m.id === rule.memberId)?.displayName ?? null,
  });
  await db.transaction(async (tx) => {
    await tx.delete(expenseNatureRules).where(eq(expenseNatureRules.id, ruleId));
    await refreshExpenseNature(
      tx,
      and(eq(transactions.merchantName, rule.merchantName), inArray(transactions.accountId, scopeAccountIds(householdScope(rule.householdId))))!,
      await loadExpenseNatureRules(tx, rule.householdId),
    );
    await logRule(tx, { householdId: rule.householdId, memberId, kind: "rule_removed", merchant: rule.merchantName, detail: `Para quem: ${label}` });
  });
  return { ok: true, message: `Regra de ${rule.merchantName} removida. O que não foi ajustado à mão volta à classificação automática.` };
}
