import type { BillLine } from "./bill-details";
import { classifyCardTransaction } from "./bills";
import type { Cents } from "./money";
import { contains, type Period } from "./periods";
import { statementNature } from "./statement";

export type ConsumptionRecord = BillLine & {
  accountId: string;
  accountKind: string;
  accountName: string;
  institutionName: string | null;
  memberName: string;
};

export type ConsumptionNature = "spending" | "refund" | "income" | "transfer" | "bill_payment";

export type Breakdown = { key: string; label: string; totalCents: Cents; count: number };

export type PeriodSummary = {
  consumptionCents: Cents;
  purchasesCount: number;
  averageTicketCents: Cents;
  refundsCents: Cents;
  refundsCount: number;
  incomeCents: Cents;
  transfersOutCents: Cents;
  transfersInCents: Cents;
  billPaymentsCents: Cents;
  uncategorizedCents: Cents;
  uncategorizedCount: number;
  pendingCount: number;
  byCategory: Breakdown[];
  byMember: Breakdown[];
  byOrigin: Breakdown[];
  byMerchant: Breakdown[];
};

export type ComparisonRow = {
  key: string;
  label: string;
  currentCents: Cents;
  currentCount: number;
  previousCents: Cents;
  previousCount: number;
  deltaCents: Cents;
  deltaPercent: number | null;
};

export const UNCATEGORIZED_KEY = "sem-categoria";
const UNCATEGORIZED_LABEL = "Sem categoria";

export function consumptionNature(record: ConsumptionRecord, billTotals: readonly Cents[]): ConsumptionNature {
  if (record.category?.kind === "transfer") {
    return "transfer";
  }
  if (record.accountKind === "credit_card") {
    const nature = classifyCardTransaction(record, billTotals);
    return nature === "purchase" ? "spending" : nature === "credit" ? "refund" : "bill_payment";
  }
  return statementNature(record);
}

export function consumptionCents(record: ConsumptionRecord, nature: ConsumptionNature) {
  if (nature === "spending") {
    return record.amountCents;
  }
  return nature === "refund" ? -record.amountCents : 0;
}

function addTo(map: Map<string, Breakdown>, key: string, label: string, cents: Cents, counts: boolean) {
  const entry = map.get(key) ?? { key, label, totalCents: 0, count: 0 };
  entry.totalCents += cents;
  entry.count += counts ? 1 : 0;
  map.set(key, entry);
}

function sorted(map: Map<string, Breakdown>) {
  return [...map.values()].sort((a, b) => b.totalCents - a.totalCents || a.label.localeCompare(b.label));
}

export function summarize(records: readonly ConsumptionRecord[], billTotals: readonly Cents[], period: Period): PeriodSummary {
  const summary: PeriodSummary = {
    consumptionCents: 0,
    purchasesCount: 0,
    averageTicketCents: 0,
    refundsCents: 0,
    refundsCount: 0,
    incomeCents: 0,
    transfersOutCents: 0,
    transfersInCents: 0,
    billPaymentsCents: 0,
    uncategorizedCents: 0,
    uncategorizedCount: 0,
    pendingCount: 0,
    byCategory: [],
    byMember: [],
    byOrigin: [],
    byMerchant: [],
  };
  const byCategory = new Map<string, Breakdown>();
  const byMember = new Map<string, Breakdown>();
  const byOrigin = new Map<string, Breakdown>();
  const byMerchant = new Map<string, Breakdown>();
  let purchasesCents = 0;

  for (const record of records) {
    if (!contains(period, record.occurredAt)) {
      continue;
    }
    const nature = consumptionNature(record, billTotals);
    if (nature === "income") {
      summary.incomeCents += record.amountCents;
      continue;
    }
    if (nature === "bill_payment") {
      summary.billPaymentsCents += record.amountCents;
      continue;
    }
    if (nature === "transfer") {
      if (record.direction === "inflow") {
        summary.transfersInCents += record.amountCents;
      } else {
        summary.transfersOutCents += record.amountCents;
      }
      continue;
    }

    const cents = consumptionCents(record, nature);
    const isPurchase = nature === "spending";
    summary.consumptionCents += cents;
    if (isPurchase) {
      summary.purchasesCount += 1;
      purchasesCents += record.amountCents;
      summary.pendingCount += record.status === "pending" ? 1 : 0;
    } else {
      summary.refundsCents += record.amountCents;
      summary.refundsCount += 1;
    }
    if (!record.category) {
      summary.uncategorizedCents += cents;
      summary.uncategorizedCount += isPurchase ? 1 : 0;
    }

    addTo(byCategory, record.category?.slug ?? UNCATEGORIZED_KEY, record.category?.name ?? UNCATEGORIZED_LABEL, cents, isPurchase);
    addTo(byMember, record.memberName, record.memberName, cents, isPurchase);
    addTo(
      byOrigin,
      record.accountId,
      `${record.accountName} · ${record.institutionName ?? "Instituição"} · ${record.memberName}`,
      cents,
      isPurchase,
    );
    const merchant = record.merchantName ?? record.description;
    addTo(byMerchant, merchant, merchant, cents, isPurchase);
  }

  summary.averageTicketCents = summary.purchasesCount > 0 ? Math.round(purchasesCents / summary.purchasesCount) : 0;
  summary.byCategory = sorted(byCategory);
  summary.byMember = sorted(byMember);
  summary.byOrigin = sorted(byOrigin);
  summary.byMerchant = sorted(byMerchant);
  return summary;
}

export function percentChange(current: number, previous: number) {
  return previous === 0 ? null : ((current - previous) / Math.abs(previous)) * 100;
}

export function compareBreakdowns(current: readonly Breakdown[], previous: readonly Breakdown[]): ComparisonRow[] {
  const rows = new Map<string, ComparisonRow>();
  const row = (entry: Breakdown) =>
    rows.get(entry.key) ?? {
      key: entry.key,
      label: entry.label,
      currentCents: 0,
      currentCount: 0,
      previousCents: 0,
      previousCount: 0,
      deltaCents: 0,
      deltaPercent: null,
    };
  for (const entry of current) {
    rows.set(entry.key, { ...row(entry), currentCents: entry.totalCents, currentCount: entry.count });
  }
  for (const entry of previous) {
    rows.set(entry.key, { ...row(entry), previousCents: entry.totalCents, previousCount: entry.count });
  }
  return [...rows.values()]
    .map((entry) => ({
      ...entry,
      deltaCents: entry.currentCents - entry.previousCents,
      deltaPercent: percentChange(entry.currentCents, entry.previousCents),
    }))
    .sort(
      (a, b) =>
        Math.max(b.currentCents, b.previousCents) - Math.max(a.currentCents, a.previousCents) || a.label.localeCompare(b.label),
    );
}
