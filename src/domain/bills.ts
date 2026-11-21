import type { Cents } from "./money";

export type CardTransactionNature = "purchase" | "bill_payment" | "credit";

export type CardTransaction = {
  amountCents: Cents;
  direction: "outflow" | "inflow";
  status: "posted" | "pending";
  description: string;
  providerCategory: string | null;
  billExternalId: string | null;
};

export type CardBill = {
  externalId: string;
  dueDate: string;
  totalCents: Cents;
};

export type BillComposition = {
  purchasesCents: Cents;
  creditsCents: Cents;
  billPaymentsCents: Cents;
  netCents: Cents;
  pendingCents: Cents;
  purchasesCount: number;
  creditsCount: number;
};

export type ClosedBillComposition = BillComposition & {
  externalId: string;
  dueDate: string;
  officialTotalCents: Cents;
  unidentifiedCents: Cents;
  incomplete: boolean;
};

const BILL_PAYMENT_CATEGORY = "Credit card payment";
const BILL_PAYMENT_DESCRIPTION = /\b(PAGAMENTO|PAGTO|PGTO)\b/;
const BILL_PAYMENT_TOLERANCE_CENTS = 10;

export function classifyCardTransaction(transaction: CardTransaction, billTotals: readonly Cents[]): CardTransactionNature {
  if (transaction.direction === "outflow") {
    return "purchase";
  }
  const description = transaction.description.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
  const isBillPayment =
    transaction.providerCategory === BILL_PAYMENT_CATEGORY ||
    BILL_PAYMENT_DESCRIPTION.test(description) ||
    billTotals.some((total) => Math.abs(total - transaction.amountCents) <= BILL_PAYMENT_TOLERANCE_CENTS);
  return isBillPayment ? "bill_payment" : "credit";
}

export function composeBill(transactions: readonly CardTransaction[], billTotals: readonly Cents[]): BillComposition {
  const composition: BillComposition = {
    purchasesCents: 0,
    creditsCents: 0,
    billPaymentsCents: 0,
    netCents: 0,
    pendingCents: 0,
    purchasesCount: 0,
    creditsCount: 0,
  };
  for (const transaction of transactions) {
    const nature = classifyCardTransaction(transaction, billTotals);
    if (nature === "purchase") {
      composition.purchasesCents += transaction.amountCents;
      composition.purchasesCount += 1;
      if (transaction.status === "pending") {
        composition.pendingCents += transaction.amountCents;
      }
    } else if (nature === "credit") {
      composition.creditsCents += transaction.amountCents;
      composition.creditsCount += 1;
    } else {
      composition.billPaymentsCents += transaction.amountCents;
    }
  }
  composition.netCents = composition.purchasesCents - composition.creditsCents;
  return composition;
}

export function composeOpenBill(transactions: readonly CardTransaction[], bills: readonly CardBill[]) {
  return composeBill(
    transactions.filter((transaction) => transaction.billExternalId === null),
    bills.map((bill) => bill.totalCents),
  );
}

export function composeClosedBills(
  transactions: readonly CardTransaction[],
  bills: readonly CardBill[],
): ClosedBillComposition[] {
  const billTotals = bills.map((bill) => bill.totalCents);
  const byBill = new Map<string, CardTransaction[]>();
  for (const transaction of transactions) {
    if (transaction.billExternalId) {
      const group = byBill.get(transaction.billExternalId) ?? [];
      group.push(transaction);
      byBill.set(transaction.billExternalId, group);
    }
  }

  const sorted = [...bills].sort((a, b) => b.dueDate.localeCompare(a.dueDate));
  return sorted.map((bill, index) => {
    const composition = composeBill(byBill.get(bill.externalId) ?? [], billTotals);
    return {
      ...composition,
      externalId: bill.externalId,
      dueDate: bill.dueDate,
      officialTotalCents: bill.totalCents,
      unidentifiedCents: bill.totalCents - composition.netCents,
      incomplete: index === sorted.length - 1,
    };
  });
}
