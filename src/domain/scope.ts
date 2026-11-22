export type Scope = { kind: "personal"; memberId: string } | { kind: "household"; householdId: string };

export const PERSONAL_CHOICE = "pessoal";
export const SCOPE_COOKIE = "kalu-escopo";

export const personalScope = (memberId: string): Scope => ({ kind: "personal", memberId });
export const householdScope = (householdId: string): Scope => ({ kind: "household", householdId });

export function resolveScope(choice: string | undefined, memberId: string, householdIds: readonly string[]): Scope {
  if (choice === PERSONAL_CHOICE) {
    return personalScope(memberId);
  }
  if (choice && householdIds.includes(choice)) {
    return householdScope(choice);
  }
  return householdIds.length > 0 ? householdScope(householdIds[0]) : personalScope(memberId);
}

export function scopeChoice(scope: Scope) {
  return scope.kind === "personal" ? PERSONAL_CHOICE : scope.householdId;
}
