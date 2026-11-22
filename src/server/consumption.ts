import "server-only";
import { and, desc, eq, gte, inArray, lt, max, min, count, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import {
  categories,
  creditCardBills,
  financialAccounts,
  householdMembers,
  integrationConnections,
  transactions,
} from "@/db/schema";
import { compareBreakdowns, summarize, type ConsumptionRecord } from "@/domain/consumption";
import { comparablePeriods, isMonth, monthOf, shiftMonth, type Period } from "@/domain/periods";
import type { Scope } from "@/domain/scope";
import { expenseMembers, expenseSelection, joinExpenseMember } from "./expense-nature";
import { scopeAccountIds } from "./scope";

export async function loadConsumptionRecords(scope: Scope, range?: Period) {
  const db = getDb();
  const [rows, bills] = await Promise.all([
    db
      .select({
        id: transactions.id,
        occurredAt: transactions.occurredAt,
        amountCents: transactions.amountCents,
        direction: transactions.direction,
        status: transactions.status,
        description: transactions.description,
        providerCategory: transactions.providerCategory,
        billExternalId: transactions.billExternalId,
        merchantName: transactions.merchantName,
        installmentNumber: transactions.installmentNumber,
        installmentTotal: transactions.installmentTotal,
        categorySource: transactions.categorySource,
        categorySlug: categories.slug,
        categoryName: categories.name,
        categoryKind: categories.kind,
        ...expenseSelection,
        accountId: financialAccounts.id,
        accountKind: financialAccounts.kind,
        accountName: financialAccounts.name,
        institutionName: integrationConnections.institutionName,
        memberName: householdMembers.displayName,
        billDueDate: creditCardBills.dueDate,
      })
      .from(transactions)
      .innerJoin(financialAccounts, eq(financialAccounts.id, transactions.accountId))
      .innerJoin(integrationConnections, eq(integrationConnections.id, financialAccounts.connectionId))
      .innerJoin(householdMembers, eq(householdMembers.id, integrationConnections.memberId))
      .leftJoin(categories, eq(categories.id, transactions.categoryId))
      .leftJoin(expenseMembers, joinExpenseMember)
      .leftJoin(creditCardBills, eq(creditCardBills.id, transactions.billId))
      .where(
        and(
          inArray(financialAccounts.id, scopeAccountIds(scope)),
          range ? gte(transactions.occurredAt, range.start) : undefined,
          range ? lt(transactions.occurredAt, range.end) : undefined,
        ),
      )
      .orderBy(desc(transactions.occurredAt)),
    db
      .select({ totalCents: creditCardBills.totalCents })
      .from(creditCardBills)
      .where(inArray(creditCardBills.accountId, scopeAccountIds(scope))),
  ]);

  const records: ConsumptionRecord[] = rows.map(({ categorySlug, categoryName, categoryKind, ...row }) => ({
    ...row,
    category: categorySlug && categoryName && categoryKind ? { slug: categorySlug, name: categoryName, kind: categoryKind } : null,
  }));
  return { records, billTotals: bills.map((bill) => bill.totalCents) };
}

export async function getDataCoverage(scope: Scope) {
  const db = getDb();
  const [[transactionRange], [sync], [balances]] = await Promise.all([
    db
      .select({ first: min(transactions.occurredAt), last: max(transactions.occurredAt), total: count() })
      .from(transactions)
      .where(inArray(transactions.accountId, scopeAccountIds(scope))),
    db
      .select({ lastSyncedAt: max(integrationConnections.lastSyncedAt) })
      .from(integrationConnections)
      .innerJoin(financialAccounts, eq(financialAccounts.connectionId, integrationConnections.id))
      .where(inArray(financialAccounts.id, scopeAccountIds(scope))),
    db
      .select({
        balanceCents: sql<number>`coalesce(sum(${financialAccounts.balanceCents}) filter (where ${financialAccounts.kind} <> 'credit_card'), 0)`.mapWith(Number),
        creditUsedCents: sql<number>`coalesce(sum(${financialAccounts.creditUsedCents}) filter (where ${financialAccounts.kind} = 'credit_card'), 0)`.mapWith(Number),
        creditLimitCents: sql<number>`coalesce(sum(${financialAccounts.creditLimitCents}) filter (where ${financialAccounts.kind} = 'credit_card'), 0)`.mapWith(Number),
      })
      .from(financialAccounts)
      .where(inArray(financialAccounts.id, scopeAccountIds(scope))),
  ]);
  return {
    firstTransactionAt: transactionRange.first,
    lastTransactionAt: transactionRange.last,
    transactionsCount: transactionRange.total,
    lastSyncedAt: sync.lastSyncedAt,
    ...balances,
  };
}

export async function availableMonths(scope: Scope) {
  const monthExpression = sql<string>`to_char(${transactions.occurredAt} at time zone 'America/Sao_Paulo', 'YYYY-MM')`;
  const rows = await getDb()
    .selectDistinct({ month: monthExpression })
    .from(transactions)
    .where(inArray(transactions.accountId, scopeAccountIds(scope)))
    .orderBy(desc(monthExpression));
  return rows.map((row) => row.month);
}

export async function getConsumptionComparison(
  scope: Scope,
  month: string | undefined,
  compareTo: string | undefined,
  now: Date,
) {
  const selectedMonth = isMonth(month) ? month : monthOf(now);
  const comparedMonth = isMonth(compareTo) && compareTo !== selectedMonth ? compareTo : shiftMonth(selectedMonth, -1);
  const periods = comparablePeriods(selectedMonth, comparedMonth, now);

  const range = {
    start: new Date(Math.min(periods.current.start.getTime(), periods.previous.start.getTime())),
    end: new Date(Math.max(periods.current.end.getTime(), periods.previous.end.getTime())),
  };
  const [{ records, billTotals }, months, coverage] = await Promise.all([
    loadConsumptionRecords(scope, range),
    availableMonths(scope),
    getDataCoverage(scope),
  ]);
  const current = summarize(records, billTotals, periods.current);
  const previous = summarize(records, billTotals, periods.previous);

  return {
    month: selectedMonth,
    compareTo: comparedMonth,
    periods,
    current,
    previous,
    byCategory: compareBreakdowns(current.byCategory, previous.byCategory),
    byExpenseNature: compareBreakdowns(current.byExpenseNature, previous.byExpenseNature),
    byMember: compareBreakdowns(current.byMember, previous.byMember),
    byOrigin: compareBreakdowns(current.byOrigin, previous.byOrigin),
    byMerchant: compareBreakdowns(current.byMerchant, previous.byMerchant),
    months,
    coverage,
    records: records.filter((record) => record.occurredAt >= periods.current.start && record.occurredAt < periods.current.end),
    billTotals,
  };
}
