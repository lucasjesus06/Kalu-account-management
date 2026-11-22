import "server-only";
import { asc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { householdMembers, householdMemberships, households } from "@/db/schema";
import type { HouseholdRole } from "@/domain/household";

export type Profile = { memberId: string; displayName: string };
export type HouseholdLink = { householdId: string; householdName: string; role: HouseholdRole };

export async function ensureProfile(userId: string, displayName: string): Promise<Profile> {
  const db = getDb();
  const find = async () => {
    const [profile] = await db
      .select({ memberId: householdMembers.id, displayName: householdMembers.displayName })
      .from(householdMembers)
      .where(eq(householdMembers.userId, userId))
      .limit(1);
    return profile;
  };
  const existing = await find();
  if (existing) {
    return existing;
  }
  await db.insert(householdMembers).values({ userId, displayName }).onConflictDoNothing({ target: householdMembers.userId });
  return (await find())!;
}

export async function listHouseholdLinks(memberId: string): Promise<HouseholdLink[]> {
  return getDb()
    .select({
      householdId: households.id,
      householdName: households.name,
      role: householdMemberships.role,
    })
    .from(householdMemberships)
    .innerJoin(households, eq(households.id, householdMemberships.householdId))
    .where(eq(householdMemberships.memberId, memberId))
    .orderBy(asc(householdMemberships.createdAt), asc(householdMemberships.id));
}
