import "server-only";
import { asc, count, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db/client";
import {
  creditCardBills,
  financialAccounts,
  householdMembers,
  integrationConnections,
  transactions,
} from "@/db/schema";

export async function listHouseholdAccounts(householdId: string) {
  const db = getDb();
  const accounts = await db
    .select({
      id: financialAccounts.id,
      kind: financialAccounts.kind,
      name: financialAccounts.name,
      numberLast4: financialAccounts.numberLast4,
      balanceCents: financialAccounts.balanceCents,
      creditLimitCents: financialAccounts.creditLimitCents,
      creditAvailableCents: financialAccounts.creditAvailableCents,
      creditUsedCents: financialAccounts.creditUsedCents,
      cardBrand: financialAccounts.cardBrand,
      institutionName: integrationConnections.institutionName,
      ownerName: householdMembers.displayName,
      lastSyncedAt: integrationConnections.lastSyncedAt,
    })
    .from(financialAccounts)
    .innerJoin(integrationConnections, eq(integrationConnections.id, financialAccounts.connectionId))
    .innerJoin(householdMembers, eq(householdMembers.id, integrationConnections.memberId))
    .where(eq(householdMembers.householdId, householdId))
    .orderBy(asc(householdMembers.displayName), asc(integrationConnections.institutionName), asc(financialAccounts.kind));

  if (accounts.length === 0) {
    return [];
  }

  const ids = accounts.map((account) => account.id);
  const [transactionCounts, billCounts] = await Promise.all([
    db
      .select({ accountId: transactions.accountId, total: count() })
      .from(transactions)
      .where(inArray(transactions.accountId, ids))
      .groupBy(transactions.accountId),
    db
      .select({ accountId: creditCardBills.accountId, total: count() })
      .from(creditCardBills)
      .where(inArray(creditCardBills.accountId, ids))
      .groupBy(creditCardBills.accountId),
  ]);

  const transactionsByAccount = new Map(transactionCounts.map((row) => [row.accountId, row.total]));
  const billsByAccount = new Map(billCounts.map((row) => [row.accountId, row.total]));

  return accounts.map((account) => ({
    ...account,
    transactionsCount: transactionsByAccount.get(account.id) ?? 0,
    billsCount: billsByAccount.get(account.id) ?? 0,
  }));
}
