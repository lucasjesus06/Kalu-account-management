import "server-only";
import { eq, inArray, or, type AnyColumn, type SQL } from "drizzle-orm";
import { getDb } from "@/db/client";
import { financialAccounts, householdMemberships, householdSharedAccounts, integrationConnections } from "@/db/schema";
import type { Scope } from "@/domain/scope";

export function ownedAccountIds(memberId: string) {
  return getDb()
    .select({ id: financialAccounts.id })
    .from(financialAccounts)
    .innerJoin(integrationConnections, eq(integrationConnections.id, financialAccounts.connectionId))
    .where(eq(integrationConnections.memberId, memberId));
}

function accountIdsSharedWithHouseholdsOf(memberId: string) {
  return getDb()
    .select({ id: householdSharedAccounts.accountId })
    .from(householdSharedAccounts)
    .where(
      inArray(
        householdSharedAccounts.householdId,
        getDb()
          .select({ id: householdMemberships.householdId })
          .from(householdMemberships)
          .where(eq(householdMemberships.memberId, memberId)),
      ),
    );
}

export function scopeAccountIds(scope: Scope) {
  if (scope.kind === "personal") {
    return ownedAccountIds(scope.memberId);
  }
  return getDb()
    .select({ id: householdSharedAccounts.accountId })
    .from(householdSharedAccounts)
    .where(eq(householdSharedAccounts.householdId, scope.householdId));
}

export function accountVisibleTo(memberId: string, accountColumn: AnyColumn): SQL {
  return or(
    inArray(accountColumn, ownedAccountIds(memberId)),
    inArray(accountColumn, accountIdsSharedWithHouseholdsOf(memberId)),
  )!;
}
