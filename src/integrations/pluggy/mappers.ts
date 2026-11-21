import type {
  ImportedAccount,
  ImportedAccountKind,
  ImportedBill,
  ImportedTransaction,
  ImportedTransactionDirection,
} from "@/domain/imported";
import { toCents } from "@/domain/money";
import type { PluggyAccount, PluggyBill, PluggyTransaction } from "./types";

const DEFAULT_CURRENCY = "BRL";

function accountKind(account: PluggyAccount): ImportedAccountKind {
  if (account.type === "CREDIT") {
    return "credit_card";
  }
  if (account.subtype === "CHECKING_ACCOUNT") {
    return "checking";
  }
  if (account.subtype === "SAVINGS_ACCOUNT") {
    return "savings";
  }
  return "other";
}

function last4(number: string | null | undefined) {
  const digits = (number ?? "").replace(/\D/g, "");
  return digits ? digits.slice(-4) : null;
}

function dateOnly(value: string | null | undefined) {
  return value ? value.slice(0, 10) : null;
}

function optionalCents(value: number | null | undefined) {
  return value === null || value === undefined ? null : toCents(value);
}

export function mapAccount(account: PluggyAccount): ImportedAccount {
  const kind = accountKind(account);
  const balanceCents = toCents(account.balance);

  return {
    externalId: account.id,
    kind,
    name: (account.marketingName ?? account.name).trim(),
    numberLast4: last4(account.number),
    currency: account.currencyCode ?? DEFAULT_CURRENCY,
    balanceCents,
    credit:
      kind === "credit_card"
        ? {
            limitCents: optionalCents(account.creditData?.creditLimit),
            availableCents: optionalCents(account.creditData?.availableCreditLimit),
            usedCents: balanceCents,
            brand: account.creditData?.brand ?? null,
            lastBillDueDate: dateOnly(account.creditData?.balanceDueDate),
          }
        : null,
  };
}

export function mapBill(bill: PluggyBill, accountExternalId: string): ImportedBill {
  return {
    externalId: bill.id,
    accountExternalId,
    dueDate: bill.dueDate.slice(0, 10),
    totalCents: toCents(bill.totalAmount),
    minimumPaymentCents: optionalCents(bill.minimumPaymentAmount),
    currency: bill.totalAmountCurrencyCode ?? DEFAULT_CURRENCY,
  };
}

function direction(transaction: PluggyTransaction, kind: ImportedAccountKind): ImportedTransactionDirection {
  if (transaction.type === "DEBIT") {
    return "outflow";
  }
  if (transaction.type === "CREDIT") {
    return "inflow";
  }
  const isNegative = transaction.amount < 0;
  if (kind === "credit_card") {
    return isNegative ? "inflow" : "outflow";
  }
  return isNegative ? "outflow" : "inflow";
}

export function mapTransaction(transaction: PluggyTransaction, account: ImportedAccount): ImportedTransaction {
  const inAccountCurrency = transaction.amountInAccountCurrency ?? null;
  const amount = inAccountCurrency ?? transaction.amount;
  const metadata = transaction.creditCardMetadata;
  const totalInstallments = metadata?.totalInstallments ?? null;

  return {
    externalId: transaction.id,
    accountExternalId: account.externalId,
    occurredAt: transaction.date,
    description: transaction.description,
    amountCents: Math.abs(toCents(amount)),
    direction: direction(transaction, account.kind),
    status: transaction.status === "PENDING" ? "pending" : "posted",
    currency: inAccountCurrency === null ? (transaction.currencyCode ?? account.currency) : account.currency,
    billExternalId: metadata?.billId ?? null,
    installment:
      totalInstallments && totalInstallments > 1 && metadata?.installmentNumber
        ? { number: metadata.installmentNumber, total: totalInstallments }
        : null,
    providerCategory: transaction.category ?? null,
  };
}
