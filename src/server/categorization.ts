import "server-only";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import {
  categories,
  categoryRules,
  financialAccounts,
  householdMembers,
  integrationConnections,
  transactions,
} from "@/db/schema";
import { UUID_PATTERN, type ActionResult } from "./connections";

export const correctionScopes = ["transaction", "merchant", "merchant_history"] as const;
export type CorrectionScope = (typeof correctionScopes)[number];

export async function listCategories() {
  return getDb()
    .select({ id: categories.id, name: categories.name })
    .from(categories)
    .orderBy(asc(categories.sortOrder));
}

function householdAccountIds(householdId: string) {
  return getDb()
    .select({ id: financialAccounts.id })
    .from(financialAccounts)
    .innerJoin(integrationConnections, eq(integrationConnections.id, financialAccounts.connectionId))
    .innerJoin(householdMembers, eq(householdMembers.id, integrationConnections.memberId))
    .where(eq(householdMembers.householdId, householdId));
}

export async function correctCategory(
  member: { memberId: string; householdId: string },
  transactionId: string,
  categoryId: string | null,
  scope: CorrectionScope,
): Promise<ActionResult> {
  if (!UUID_PATTERN.test(transactionId) || (categoryId !== null && !UUID_PATTERN.test(categoryId))) {
    return { ok: false, error: "Transação ou categoria inválida." };
  }
  if (categoryId === null && scope !== "transaction") {
    return { ok: false, error: "Escolha uma categoria para criar uma regra." };
  }

  const db = getDb();
  const [transaction] = await db
    .select({ id: transactions.id, merchantName: transactions.merchantName, description: transactions.description })
    .from(transactions)
    .where(and(eq(transactions.id, transactionId), inArray(transactions.accountId, householdAccountIds(member.householdId))));
  if (!transaction) {
    return { ok: false, error: "Transação não encontrada." };
  }

  let category: { id: string; name: string } | undefined;
  if (categoryId) {
    [category] = await db
      .select({ id: categories.id, name: categories.name })
      .from(categories)
      .where(eq(categories.id, categoryId));
    if (!category) {
      return { ok: false, error: "Categoria não encontrada." };
    }
  }

  const merchant = transaction.merchantName ?? transaction.description;
  const categoryLabel = category?.name ?? "Sem categoria";

  if (scope === "transaction") {
    await db
      .update(transactions)
      .set({ categoryId, categorySource: "user", updatedAt: new Date() })
      .where(eq(transactions.id, transaction.id));
    return { ok: true, message: `Categoria alterada para ${categoryLabel} somente nesta transação.` };
  }

  const updatedHistory = await db.transaction(async (tx) => {
    await tx
      .insert(categoryRules)
      .values({
        householdId: member.householdId,
        merchantName: merchant,
        categoryId: category!.id,
        createdByMemberId: member.memberId,
      })
      .onConflictDoUpdate({
        target: [categoryRules.householdId, categoryRules.merchantName],
        set: { categoryId: category!.id, createdByMemberId: member.memberId, updatedAt: new Date() },
      });

    await tx
      .update(transactions)
      .set({ categoryId: category!.id, categorySource: "rule", updatedAt: new Date() })
      .where(eq(transactions.id, transaction.id));

    if (scope !== "merchant_history") {
      return 0;
    }
    const updated = await tx
      .update(transactions)
      .set({ categoryId: category!.id, categorySource: "rule", updatedAt: new Date() })
      .where(
        and(
          eq(transactions.merchantName, merchant),
          inArray(transactions.accountId, householdAccountIds(member.householdId)),
          sql`${transactions.categorySource} is distinct from 'user'`,
          sql`${transactions.categoryId} is distinct from ${category!.id}`,
        ),
      )
      .returning({ id: transactions.id });
    return updated.length;
  });

  if (scope === "merchant") {
    return {
      ok: true,
      message: `Categoria alterada para ${categoryLabel}. As próximas transações de ${merchant} também serão classificadas assim.`,
    };
  }
  return {
    ok: true,
    message: `Categoria alterada para ${categoryLabel} em ${merchant}, incluindo ${updatedHistory} ${updatedHistory === 1 ? "transação anterior" : "transações anteriores"}. Ajustes feitos só numa transação foram mantidos.`,
  };
}
