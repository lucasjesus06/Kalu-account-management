import type { Cents } from "./money";

export type ImportedAccountKind = "checking" | "savings" | "credit_card" | "other";

export type ImportedAccount = {
  externalId: string;
  kind: ImportedAccountKind;
  name: string;
  numberLast4: string | null;
  currency: string;
  balanceCents: Cents;
  credit: {
    limitCents: Cents | null;
    availableCents: Cents | null;
    usedCents: Cents;
    brand: string | null;
    lastBillDueDate: string | null;
  } | null;
};

export type ImportedBill = {
  externalId: string;
  accountExternalId: string;
  dueDate: string;
  totalCents: Cents;
  minimumPaymentCents: Cents | null;
  currency: string;
};

export type ImportedTransactionDirection = "outflow" | "inflow";

export type ImportedTransaction = {
  externalId: string;
  accountExternalId: string;
  occurredAt: string;
  description: string;
  amountCents: Cents;
  direction: ImportedTransactionDirection;
  status: "posted" | "pending";
  currency: string;
  billExternalId: string | null;
  installment: { number: number; total: number } | null;
  providerCategory: string | null;
};
