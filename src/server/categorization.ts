import "server-only";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { categories, categoryRules, transactions } from "@/db/schema";
import { UUID_PATTERN, type ActionResult } from "./connections";
import { recordChange } from "./change-log";
import { refreshOwnedExpenseNature, type Editor } from "./expense-nature";
import { accountVisibleTo, ownedAccountIds } from "./scope";

export const correctionScopes = ["transaction", "merchant", "merchant_history"] as const;
export type CorrectionScope = (typeof correctionScopes)[number];

export async function listCategories() {
  return getDb()
    .select({ id: categories.id, slug: categories.slug, name: categories.name, kind: categories.kind })
    .from(categories)
    .orderBy(asc(categories.sortOrder));
}

export async function correctCategory(
  member: Editor,
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
    .select({
      id: transactions.id,
      merchantName: transactions.merchantName,
      description: transactions.description,
      categoryName: categories.name,
      owned: inArray(transactions.accountId, ownedAccountIds(member.memberId)),
    })
    .from(transactions)
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .where(and(eq(transactions.id, transactionId), accountVisibleTo(member.memberId, transactions.accountId)));
  if (!transaction) {
    return { ok: false, error: "Transação não encontrada." };
  }
  if (!transaction.owned) {
    return { ok: false, error: "A categoria só pode ser alterada por quem conectou a conta." };
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
  const previousLabel = transaction.categoryName ?? "Sem categoria";
  const logChange = async (executor: Parameters<typeof recordChange>[0], affectedCount: number) => {
    if (!member.householdId) {
      return;
    }
    await recordChange(executor, {
      householdId: member.householdId,
      memberId: member.memberId,
      kind: "category_changed",
      subject: merchant,
      scope,
      previousValue: previousLabel,
      newValue: categoryLabel,
      affectedCount,
    });
  };

  if (scope === "transaction") {
    await db.transaction(async (tx) => {
      await tx
        .update(transactions)
        .set({ categoryId, categorySource: "user", updatedAt: new Date() })
        .where(eq(transactions.id, transaction.id));
      await logChange(tx, 1);
    });
    await refreshOwnedExpenseNature(db, member.memberId, eq(transactions.id, transaction.id));
    return { ok: true, message: `Categoria alterada para ${categoryLabel} somente nesta transação.` };
  }

  const updatedHistory = await db.transaction(async (tx) => {
    await tx
      .insert(categoryRules)
      .values({
        ownerMemberId: member.memberId,
        merchantName: merchant,
        categoryId: category!.id,
        createdByMemberId: member.memberId,
      })
      .onConflictDoUpdate({
        target: [categoryRules.ownerMemberId, categoryRules.merchantName],
        set: { categoryId: category!.id, updatedAt: new Date() },
      });

    await tx
      .update(transactions)
      .set({ categoryId: category!.id, categorySource: "rule", updatedAt: new Date() })
      .where(eq(transactions.id, transaction.id));

    if (scope !== "merchant_history") {
      await logChange(tx, 1);
      return 0;
    }
    const updated = await tx
      .update(transactions)
      .set({ categoryId: category!.id, categorySource: "rule", updatedAt: new Date() })
      .where(
        and(
          eq(transactions.merchantName, merchant),
          inArray(transactions.accountId, ownedAccountIds(member.memberId)),
          sql`${transactions.categorySource} is distinct from 'user'`,
          sql`${transactions.categoryId} is distinct from ${category!.id}`,
        ),
      )
      .returning({ id: transactions.id });
    await logChange(tx, updated.length + 1);
    return updated.length;
  });
  await refreshOwnedExpenseNature(
    db,
    member.memberId,
    scope === "merchant_history" ? eq(transactions.merchantName, merchant) : eq(transactions.id, transaction.id),
  );

  if (scope === "merchant") {
    return {
      ok: true,
      message: `Categoria alterada para ${categoryLabel}. As próximas transações de ${merchant} também serão classificadas assim.`,
    };
  }
  return {
    ok: true,
    message: `Categoria alterada para ${categoryLabel} em ${merchant}, incluindo ${updatedHistory === 0 ? "nenhuma transação anterior" : updatedHistory === 1 ? "1 transação anterior" : `${updatedHistory} transações anteriores`}. Ajustes feitos só numa transação foram mantidos.`,
  };
}
