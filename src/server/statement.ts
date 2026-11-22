import "server-only";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { categories, financialAccounts, householdMembers, integrationConnections, transactions } from "@/db/schema";
import { summarizeStatement, type StatementLine } from "@/domain/statement";
import type { Scope } from "@/domain/scope";
import { UUID_PATTERN } from "./connections";
import { expenseMembers, expenseSelection, joinExpenseMember } from "./expense-nature";
import { scopeAccountIds } from "./scope";

const TIME_ZONE = "America/Sao_Paulo";
const MONTH_PATTERN = /^\d{4}-(?:0[1-9]|1[0-2])$/;

export async function getAccountStatement(scope: Scope, accountId: string, month: string | undefined) {
  if (!UUID_PATTERN.test(accountId)) {
    return null;
  }
  const db = getDb();
  const [account] = await db
    .select({
      id: financialAccounts.id,
      name: financialAccounts.name,
      numberLast4: financialAccounts.numberLast4,
      balanceCents: financialAccounts.balanceCents,
      institutionName: integrationConnections.institutionName,
      ownerName: householdMembers.displayName,
    })
    .from(financialAccounts)
    .innerJoin(integrationConnections, eq(integrationConnections.id, financialAccounts.connectionId))
    .innerJoin(householdMembers, eq(householdMembers.id, integrationConnections.memberId))
    .where(
      and(
        eq(financialAccounts.id, accountId),
        ne(financialAccounts.kind, "credit_card"),
        inArray(financialAccounts.id, scopeAccountIds(scope)),
      ),
    );
  if (!account) {
    return null;
  }

  const monthOf = sql<string>`to_char(${transactions.occurredAt} at time zone ${sql.raw(`'${TIME_ZONE}'`)}, 'YYYY-MM')`;
  const months = (
    await db
      .selectDistinct({ month: monthOf })
      .from(transactions)
      .where(eq(transactions.accountId, accountId))
      .orderBy(desc(monthOf))
  ).map((row) => row.month);

  const selectedMonth = month && MONTH_PATTERN.test(month) && months.includes(month) ? month : months[0];
  const rows = selectedMonth
    ? await db
        .select({
          id: transactions.id,
          occurredAt: transactions.occurredAt,
          amountCents: transactions.amountCents,
          direction: transactions.direction,
          status: transactions.status,
          description: transactions.description,
          providerCategory: transactions.providerCategory,
          merchantName: transactions.merchantName,
          installmentNumber: transactions.installmentNumber,
          installmentTotal: transactions.installmentTotal,
          categorySource: transactions.categorySource,
          categorySlug: categories.slug,
          categoryName: categories.name,
          categoryKind: categories.kind,
          ...expenseSelection,
        })
        .from(transactions)
        .leftJoin(categories, eq(categories.id, transactions.categoryId))
        .leftJoin(expenseMembers, joinExpenseMember)
        .where(and(eq(transactions.accountId, accountId), eq(monthOf, selectedMonth)))
        .orderBy(desc(transactions.occurredAt))
    : [];

  const lines: StatementLine[] = rows.map(({ categorySlug, categoryName, categoryKind, ...row }) => ({
    ...row,
    category: categorySlug && categoryName && categoryKind ? { slug: categorySlug, name: categoryName, kind: categoryKind } : null,
  }));

  return { account, months, selectedMonth: selectedMonth ?? null, lines, summary: summarizeStatement(lines) };
}
