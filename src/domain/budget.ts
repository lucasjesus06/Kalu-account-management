import { consumptionCents, consumptionNature, type ConsumptionRecord } from "./consumption";
import { expenseNatureKey, expenseNatureLabel, type ExpenseNature } from "./expense-nature";
import type { Cents } from "./money";
import { contains, type Period } from "./periods";

export const DEFAULT_THRESHOLDS = [70, 90, 100] as const;
export const MAX_THRESHOLDS = 5;
export const MAX_THRESHOLD = 300;

export type BudgetGoal = {
  id: string;
  categorySlug: string | null;
  categoryName: string | null;
  nature: ExpenseNature | null;
  memberId: string | null;
  memberName: string | null;
  limitCents: Cents;
  thresholds: number[];
  startsMonth: string;
  endsMonth: string | null;
};

export type GoalStatus = "ok" | "warning" | "over";

export type GoalProgress = {
  consumedCents: Cents;
  purchasesCount: number;
  percent: number;
  remainingCents: Cents;
  reached: number[];
  status: GoalStatus;
};

export function parseMoneyInput(text: string): Cents | null {
  const cleaned = text.replace(/R\$|\s/g, "");
  let normalized: string;
  if (/^(?:\d{1,3}(?:\.\d{3})+|\d+),\d{1,2}$/.test(cleaned)) {
    normalized = cleaned.replace(/\./g, "").replace(",", ".");
  } else if (/^\d{1,3}(?:\.\d{3})+$/.test(cleaned)) {
    normalized = cleaned.replace(/\./g, "");
  } else if (/^\d+(?:\.\d{1,2})?$/.test(cleaned)) {
    normalized = cleaned;
  } else {
    return null;
  }
  const cents = Math.round(Number(normalized) * 100);
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
}

export function parseThresholds(text: string): number[] | null {
  const parts = text
    .split(/[\s,;%]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0 || parts.length > MAX_THRESHOLDS || parts.some((part) => !/^\d+$/.test(part))) {
    return null;
  }
  const values = [...new Set(parts.map(Number))].sort((a, b) => a - b);
  return values.every((value) => value >= 1 && value <= MAX_THRESHOLD) ? values : null;
}

export function isActiveIn(goal: Pick<BudgetGoal, "startsMonth" | "endsMonth">, month: string) {
  return goal.startsMonth <= month && (goal.endsMonth === null || month <= goal.endsMonth);
}

export function sameTarget(
  a: Pick<BudgetGoal, "categorySlug" | "nature" | "memberId">,
  b: Pick<BudgetGoal, "categorySlug" | "nature" | "memberId">,
) {
  return a.categorySlug === b.categorySlug && a.nature === b.nature && a.memberId === b.memberId;
}

export function goalLabel(goal: Pick<BudgetGoal, "categoryName" | "nature" | "memberId" | "memberName">) {
  const category = goal.categoryName ?? "Todo o consumo";
  return goal.nature ? `${category} · ${expenseNatureLabel(goal)}` : category;
}

export function goalMatches(goal: Pick<BudgetGoal, "categorySlug" | "nature" | "memberId">, record: ConsumptionRecord) {
  if (goal.categorySlug !== null && record.category?.slug !== goal.categorySlug) {
    return false;
  }
  if (goal.nature === null) {
    return true;
  }
  return (
    expenseNatureKey({ nature: record.expenseNature, memberId: record.expenseMemberId }) ===
    expenseNatureKey({ nature: goal.nature, memberId: goal.memberId })
  );
}

export function goalProgress(
  goal: Pick<BudgetGoal, "categorySlug" | "nature" | "memberId" | "limitCents" | "thresholds">,
  records: readonly ConsumptionRecord[],
  billTotals: readonly Cents[],
  period: Period,
): GoalProgress {
  let consumed = 0;
  let purchases = 0;
  for (const record of records) {
    if (!contains(period, record.occurredAt) || !goalMatches(goal, record)) {
      continue;
    }
    const nature = consumptionNature(record, billTotals);
    if (nature !== "spending" && nature !== "refund") {
      continue;
    }
    consumed += consumptionCents(record, nature);
    purchases += nature === "spending" ? 1 : 0;
  }
  const percent = goal.limitCents > 0 ? (consumed / goal.limitCents) * 100 : 0;
  const reached = goal.thresholds.filter((threshold) => consumed * 100 >= goal.limitCents * threshold);
  const firstThreshold = Math.min(...goal.thresholds);
  return {
    consumedCents: consumed,
    purchasesCount: purchases,
    percent,
    remainingCents: goal.limitCents - consumed,
    reached,
    status: consumed >= goal.limitCents ? "over" : percent >= firstThreshold ? "warning" : "ok",
  };
}
