import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db/client";
import {
  categories,
  creditCardBills,
  financialAccounts,
  householdMembers,
  integrationConnections,
  transactions,
} from "@/db/schema";
import {
  creditLines,
  futureInstallments,
  groupByCategory,
  paymentStatus,
  topMerchants,
  type BillLine,
} from "@/domain/bill-details";
import { UUID_PATTERN } from "./connections";
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

export const OPEN_CYCLE = "aberta";

export async function getCardBillDetail(householdId: string, accountId: string, cycleKey: string | undefined) {
  if (!UUID_PATTERN.test(accountId)) {
    return null;
  }
  const db = getDb();
  const [account] = await db
    .select({
      id: financialAccounts.id,
      name: financialAccounts.name,
      numberLast4: financialAccounts.numberLast4,
      institutionName: integrationConnections.institutionName,
      ownerName: householdMembers.displayName,
    })
    .from(financialAccounts)
    .innerJoin(integrationConnections, eq(integrationConnections.id, financialAccounts.connectionId))
    .innerJoin(householdMembers, eq(householdMembers.id, integrationConnections.memberId))
    .where(
      and(
        eq(financialAccounts.id, accountId),
        eq(financialAccounts.kind, "credit_card"),
        eq(householdMembers.householdId, householdId),
      ),
    );
  if (!account) {
    return null;
  }

  const [bills, rows] = await Promise.all([
    db
      .select({
        externalId: creditCardBills.externalId,
        dueDate: creditCardBills.dueDate,
        totalCents: creditCardBills.totalCents,
      })
      .from(creditCardBills)
      .where(eq(creditCardBills.accountId, accountId)),
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
        categorySlug: categories.slug,
        categoryName: categories.name,
      })
      .from(transactions)
      .leftJoin(categories, eq(categories.id, transactions.categoryId))
      .where(eq(transactions.accountId, accountId)),
  ]);

  const lines: BillLine[] = rows.map(({ categorySlug, categoryName, ...row }) => ({
    ...row,
    category: categorySlug && categoryName ? { slug: categorySlug, name: categoryName } : null,
  }));
  const billTotals = bills.map((bill) => bill.totalCents);
  const open = composeOpenBill(lines, bills);
  const closed = composeClosedBills(lines, bills);

  const closedIndex = closed.findIndex((bill) => bill.externalId === cycleKey);
  const selectedLines =
    closedIndex === -1
      ? lines.filter((line) => line.billExternalId === null)
      : lines.filter((line) => line.billExternalId === closed[closedIndex].externalId);

  let selected;
  if (closedIndex === -1) {
    selected = { key: OPEN_CYCLE, isOpen: true as const, composition: open };
  } else {
    const bill = closed[closedIndex];
    const paidCents = closedIndex === 0 ? open.billPaymentsCents : closed[closedIndex - 1].billPaymentsCents;
    selected = {
      key: bill.externalId,
      isOpen: false as const,
      composition: bill,
      paidCents,
      status: paymentStatus(bill.officialTotalCents, paidCents),
    };
  }

  return {
    account,
    cycles: [
      { key: OPEN_CYCLE, dueDate: null },
      ...closed.map((bill) => ({ key: bill.externalId, dueDate: bill.dueDate })),
    ],
    selected,
    categories: groupByCategory(selectedLines, billTotals),
    merchants: topMerchants(selectedLines, billTotals),
    credits: creditLines(selectedLines, billTotals),
    installments: futureInstallments(selectedLines, billTotals),
  };
}
