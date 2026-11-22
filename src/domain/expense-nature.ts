import type { CategoryKind, CategorySlug } from "./categories";

export const expenseNatures = ["household", "shared", "individual"] as const;
export type ExpenseNature = (typeof expenseNatures)[number];

export const expenseNatureSources = ["automatic", "rule", "user"] as const;
export type ExpenseNatureSource = (typeof expenseNatureSources)[number];

export type ExpenseAssignment = { nature: ExpenseNature; memberId: string | null };

export const householdCategories: ReadonlySet<string> = new Set<CategorySlug>(["moradia", "energia", "agua", "supermercado"]);

export const UNDEFINED_NATURE_KEY = "sem-definicao";
export const UNDEFINED_NATURE_LABEL = "Sem definição";

export const natureLabels = { household: "Casa", shared: "Compartilhado" } as const;

export function resolveExpenseNature(
  transaction: { merchantName: string | null; category: { slug: string; kind: CategoryKind } | null },
  rules: ReadonlyMap<string, ExpenseAssignment>,
): { assignment: ExpenseAssignment; source: Exclude<ExpenseNatureSource, "user"> } | null {
  if (transaction.category?.kind === "transfer") {
    return null;
  }
  const rule = transaction.merchantName ? rules.get(transaction.merchantName) : undefined;
  if (rule) {
    return { assignment: rule, source: "rule" };
  }
  if (transaction.category && householdCategories.has(transaction.category.slug)) {
    return { assignment: { nature: "household", memberId: null }, source: "automatic" };
  }
  return null;
}

export function parseExpenseChoice(value: string, memberIds: readonly string[]): ExpenseAssignment | null | undefined {
  if (value === "") {
    return null;
  }
  if (value === "household" || value === "shared") {
    return { nature: value, memberId: null };
  }
  return memberIds.includes(value) ? { nature: "individual", memberId: value } : undefined;
}

export function expenseChoiceOf(assignment: { nature: ExpenseNature | null; memberId: string | null }) {
  if (assignment.nature === "individual") {
    return assignment.memberId ?? "";
  }
  return assignment.nature ?? "";
}

export function expenseNatureKey(assignment: { nature: ExpenseNature | null; memberId: string | null }) {
  if (!assignment.nature || (assignment.nature === "individual" && !assignment.memberId)) {
    return UNDEFINED_NATURE_KEY;
  }
  return assignment.nature === "individual" ? `integrante-${assignment.memberId}` : assignment.nature;
}

export function expenseNatureLabel(assignment: {
  nature: ExpenseNature | null;
  memberId: string | null;
  memberName: string | null;
}) {
  if (assignment.nature === "individual") {
    return assignment.memberId && assignment.memberName ? assignment.memberName : UNDEFINED_NATURE_LABEL;
  }
  return assignment.nature ? natureLabels[assignment.nature] : UNDEFINED_NATURE_LABEL;
}
