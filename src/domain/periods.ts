export type Period = { start: Date; end: Date };

export type ComparablePeriods = { current: Period; previous: Period; partial: boolean };

const BRASILIA_OFFSET_HOURS = 3;
const MONTH_PATTERN = /^\d{4}-(?:0[1-9]|1[0-2])$/;
const DAY_MS = 86_400_000;

export function isMonth(value: string | undefined): value is string {
  return value !== undefined && MONTH_PATTERN.test(value);
}

function brasiliaParts(date: Date) {
  const local = new Date(date.getTime() - BRASILIA_OFFSET_HOURS * 3_600_000);
  return { year: local.getUTCFullYear(), month: local.getUTCMonth() + 1, day: local.getUTCDate() };
}

export function dateOf(date: Date) {
  const { year, month, day } = brasiliaParts(date);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function monthOf(date: Date) {
  const { year, month } = brasiliaParts(date);
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function monthStart(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(Date.UTC(year, monthNumber - 1, 1, BRASILIA_OFFSET_HOURS));
}

export function shiftMonth(month: string, offset: number) {
  const [year, monthNumber] = month.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, monthNumber - 1 + offset, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function daysInMonth(month: string) {
  return Math.round((monthStart(shiftMonth(month, 1)).getTime() - monthStart(month).getTime()) / DAY_MS);
}

export function fullMonth(month: string): Period {
  return { start: monthStart(month), end: monthStart(shiftMonth(month, 1)) };
}

export function comparablePeriods(month: string, compareTo: string, now: Date): ComparablePeriods {
  if (month !== monthOf(now)) {
    return { current: fullMonth(month), previous: fullMonth(compareTo), partial: false };
  }
  const elapsedDays = brasiliaParts(now).day;
  const previousStart = monthStart(compareTo);
  const previousDays = Math.min(elapsedDays, daysInMonth(compareTo));
  return {
    current: { start: monthStart(month), end: now },
    previous: { start: previousStart, end: new Date(previousStart.getTime() + previousDays * DAY_MS) },
    partial: true,
  };
}

export function contains(period: Period, date: Date) {
  return date.getTime() >= period.start.getTime() && date.getTime() < period.end.getTime();
}
