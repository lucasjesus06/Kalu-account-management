import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db/client";
import { creditCardBills, financialAccounts, householdMembers, integrationConnections, transactions } from "@/db/schema";
import {
  composeClosedBills,
  composeOpenBill,
  type BillComposition,
  type CardBill,
  type CardTransaction,
  type ClosedBillComposition,
} from "@/domain/bills";

export type CardBills = { open: BillComposition; closed: ClosedBillComposition[] };

function groupByAccount<T extends { accountId: string }>(rows: T[]) {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const group = groups.get(row.accountId) ?? [];
    group.push(row);
    groups.set(row.accountId, group);
  }
  return groups;
}

export async function listHouseholdCardBills(householdId: string) {
  const db = getDb();
  const cards = await db
    .select({ id: financialAccounts.id })
    .from(financialAccounts)
    .innerJoin(integrationConnections, eq(integrationConnections.id, financialAccounts.connectionId))
    .innerJoin(householdMembers, eq(householdMembers.id, integrationConnections.memberId))
    .where(and(eq(householdMembers.householdId, householdId), eq(financialAccounts.kind, "credit_card")));

  const result = new Map<string, CardBills>();
  if (cards.length === 0) {
    return result;
  }

  const ids = cards.map((card) => card.id);
  const [billRows, transactionRows] = await Promise.all([
    db
      .select({
        accountId: creditCardBills.accountId,
        externalId: creditCardBills.externalId,
        dueDate: creditCardBills.dueDate,
        totalCents: creditCardBills.totalCents,
      })
      .from(creditCardBills)
      .where(inArray(creditCardBills.accountId, ids)),
    db
      .select({
        accountId: transactions.accountId,
        amountCents: transactions.amountCents,
        direction: transactions.direction,
        status: transactions.status,
        description: transactions.description,
        providerCategory: transactions.providerCategory,
        billExternalId: transactions.billExternalId,
      })
      .from(transactions)
      .where(inArray(transactions.accountId, ids)),
  ]);

  const billsByAccount = groupByAccount(billRows);
  const transactionsByAccount = groupByAccount(transactionRows);
  for (const id of ids) {
    const bills: CardBill[] = billsByAccount.get(id) ?? [];
    const cardTransactions: CardTransaction[] = transactionsByAccount.get(id) ?? [];
    result.set(id, {
      open: composeOpenBill(cardTransactions, bills),
      closed: composeClosedBills(cardTransactions, bills),
    });
  }
  return result;
}
