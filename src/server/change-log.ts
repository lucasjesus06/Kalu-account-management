import "server-only";
import { desc, eq, and, inArray } from "drizzle-orm";
import { getDb } from "@/db/client";
import { changeLog, householdMembers } from "@/db/schema";
import { changeFilters, type ChangeFilter, type ChangeKind, type ChangeScope } from "@/domain/change-log";

type Db = ReturnType<typeof getDb>;
type Executor = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

export type ChangeEntry = {
  householdId: string;
  memberId: string;
  kind: ChangeKind;
  subject: string;
  scope?: ChangeScope;
  previousValue: string | null;
  newValue: string | null;
  affectedCount?: number;
};

export async function recordChange(db: Executor, entry: ChangeEntry) {
  await db.insert(changeLog).values({
    householdId: entry.householdId,
    memberId: entry.memberId,
    kind: entry.kind,
    subject: entry.subject,
    scope: entry.scope ?? null,
    previousValue: entry.previousValue,
    newValue: entry.newValue,
    affectedCount: entry.affectedCount ?? 1,
  });
}

export async function listChanges(householdId: string, filter: ChangeFilter = "todas", limit = 100) {
  const kinds = changeFilters.find((f) => f.value === filter)!.kinds;
  return getDb()
    .select({
      id: changeLog.id,
      kind: changeLog.kind,
      subject: changeLog.subject,
      scope: changeLog.scope,
      previousValue: changeLog.previousValue,
      newValue: changeLog.newValue,
      affectedCount: changeLog.affectedCount,
      occurredAt: changeLog.occurredAt,
      memberName: householdMembers.displayName,
    })
    .from(changeLog)
    .leftJoin(householdMembers, eq(householdMembers.id, changeLog.memberId))
    .where(and(eq(changeLog.householdId, householdId), inArray(changeLog.kind, [...kinds])))
    .orderBy(desc(changeLog.occurredAt))
    .limit(limit);
}
