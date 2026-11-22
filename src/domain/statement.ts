import type { BillLine } from "./bill-details";
import type { Cents } from "./money";

export type StatementLine = Omit<BillLine, "billExternalId">;

export type StatementNature = "income" | "spending" | "bill_payment" | "transfer";

export type StatementSummary = {
  incomeCents: Cents;
  spendingCents: Cents;
  billPaymentsCents: Cents;
  transfersInCents: Cents;
  transfersOutCents: Cents;
};

const BILL_PAYMENT_CATEGORY = "Credit card payment";
const BILL_PAYMENT_DESCRIPTION = /\b(?:PAGAMENTO|PAGTO|PGTO)\b.*\b(?:FATURA|CARTAO|CARTOES)\b/;

export function statementNature(line: StatementLine): StatementNature {
  if (line.category?.kind === "transfer") {
    return "transfer";
  }
  if (line.direction === "inflow") {
    return "income";
  }
  const description = line.description.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
  if (line.providerCategory === BILL_PAYMENT_CATEGORY || BILL_PAYMENT_DESCRIPTION.test(description)) {
    return "bill_payment";
  }
  return "spending";
}

export function summarizeStatement(lines: readonly StatementLine[]): StatementSummary {
  const summary: StatementSummary = {
    incomeCents: 0,
    spendingCents: 0,
    billPaymentsCents: 0,
    transfersInCents: 0,
    transfersOutCents: 0,
  };
  for (const line of lines) {
    const nature = statementNature(line);
    if (nature === "income") {
      summary.incomeCents += line.amountCents;
    } else if (nature === "spending") {
      summary.spendingCents += line.amountCents;
    } else if (nature === "bill_payment") {
      summary.billPaymentsCents += line.amountCents;
    } else if (line.direction === "inflow") {
      summary.transfersInCents += line.amountCents;
    } else {
      summary.transfersOutCents += line.amountCents;
    }
  }
  return summary;
}
