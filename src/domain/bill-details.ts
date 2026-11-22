import { BILL_PAYMENT_TOLERANCE_CENTS, classifyCardTransaction, type CardTransaction } from "./bills";
import type { CategoryKind } from "./categories";
import type { Cents } from "./money";

export type BillLine = CardTransaction & {
  id: string;
  occurredAt: Date;
  merchantName: string | null;
  category: { slug: string; name: string; kind: CategoryKind } | null;
  categorySource: "automatic" | "rule" | "user" | null;
  installmentNumber: number | null;
  installmentTotal: number | null;
};

export type CategoryGroup = {
  slug: string | null;
  name: string;
  kind: CategoryKind | null;
  netCents: Cents;
  count: number;
  lines: BillLine[];
};

export type MerchantTotal = { name: string; netCents: Cents; count: number };

export type FutureInstallment = {
  line: BillLine;
  remaining: number;
  remainingCents: Cents;
};

export type PaymentStatus = "paid" | "partially_paid" | "unpaid";

const UNCATEGORIZED = "Sem categoria";

function signedAmount(line: BillLine, billTotals: readonly Cents[]) {
  const nature = classifyCardTransaction(line, billTotals);
  if (nature === "bill_payment") {
    return null;
  }
  return nature === "purchase" ? line.amountCents : -line.amountCents;
}

export function groupByCategory(lines: readonly BillLine[], billTotals: readonly Cents[]): CategoryGroup[] {
  const groups = new Map<string, CategoryGroup>();
  for (const line of lines) {
    const amount = signedAmount(line, billTotals);
    if (amount === null) {
      continue;
    }
    const key = line.category?.slug ?? "";
    const group = groups.get(key) ?? {
      slug: line.category?.slug ?? null,
      name: line.category?.name ?? UNCATEGORIZED,
      kind: line.category?.kind ?? null,
      netCents: 0,
      count: 0,
      lines: [],
    };
    group.netCents += amount;
    group.count += 1;
    group.lines.push(line);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    group.lines.sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
  }
  const order = (group: CategoryGroup) => (group.kind === "expense" ? 0 : group.kind === null ? 1 : 2);
  return [...groups.values()].sort((a, b) => order(a) - order(b) || b.netCents - a.netCents);
}

export function topMerchants(lines: readonly BillLine[], billTotals: readonly Cents[], limit = 5): MerchantTotal[] {
  const totals = new Map<string, MerchantTotal>();
  for (const line of lines) {
    const amount = signedAmount(line, billTotals);
    if (amount === null || line.category?.kind === "transfer") {
      continue;
    }
    const name = line.merchantName ?? line.description;
    const total = totals.get(name) ?? { name, netCents: 0, count: 0 };
    total.netCents += amount;
    total.count += 1;
    totals.set(name, total);
  }
  return [...totals.values()]
    .filter((total) => total.netCents > 0)
    .sort((a, b) => b.netCents - a.netCents)
    .slice(0, limit);
}

export function creditLines(lines: readonly BillLine[], billTotals: readonly Cents[]) {
  return lines.filter((line) => classifyCardTransaction(line, billTotals) === "credit");
}

export function futureInstallments(lines: readonly BillLine[], billTotals: readonly Cents[]): FutureInstallment[] {
  return lines
    .filter(
      (line) =>
        classifyCardTransaction(line, billTotals) === "purchase" &&
        line.installmentNumber !== null &&
        line.installmentTotal !== null &&
        line.installmentNumber < line.installmentTotal,
    )
    .map((line) => {
      const remaining = line.installmentTotal! - line.installmentNumber!;
      return { line, remaining, remainingCents: remaining * line.amountCents };
    })
    .sort((a, b) => b.remainingCents - a.remainingCents);
}

export function paymentStatus(officialTotalCents: Cents, paidCents: Cents): PaymentStatus {
  if (paidCents <= 0) {
    return "unpaid";
  }
  return paidCents >= officialTotalCents - BILL_PAYMENT_TOLERANCE_CENTS ? "paid" : "partially_paid";
}
