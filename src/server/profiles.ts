import "server-only";
import { asc, eq } from "drizzle-orm";
import { asService, getDb } from "@/db/client";
import { householdMembers, householdMemberships, households } from "@/db/schema";
import type { HouseholdRole } from "@/domain/household";

export type Profile = { memberId: string; displayName: string };
export type HouseholdLink = { householdId: string; householdName: string; role: HouseholdRole };

async function ensureProfileImpl(userId: string, displayName: string): Promise<Profile> {
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

export async function listHouseholdMembers(householdId: string) {
  return getDb()
    .select({ id: householdMembers.id, displayName: householdMembers.displayName })
    .from(householdMemberships)
    .innerJoin(householdMembers, eq(householdMembers.id, householdMemberships.memberId))
    .where(eq(householdMemberships.householdId, householdId))
    .orderBy(asc(householdMemberships.createdAt), asc(householdMemberships.id));
}

export async function updateDisplayName(memberId: string, name: string) {
  await getDb().update(householdMembers).set({ displayName: name }).where(eq(householdMembers.id, memberId));
}

async function loadAccessImpl(userId: string, displayName: string): Promise<{ profile: Profile; households: HouseholdLink[] }> {
  const read = () =>
    getDb()
      .select({
        memberId: householdMembers.id,
        displayName: householdMembers.displayName,
        householdId: households.id,
        householdName: households.name,
        role: householdMemberships.role,
      })
      .from(householdMembers)
      .leftJoin(householdMemberships, eq(householdMemberships.memberId, householdMembers.id))
      .leftJoin(households, eq(households.id, householdMemberships.householdId))
      .where(eq(householdMembers.userId, userId))
      .orderBy(asc(householdMemberships.createdAt), asc(householdMemberships.id));

  let rows = await read();
  if (rows.length === 0) {
    await ensureProfileImpl(userId, displayName);
    rows = await read();
  }
  const [first] = rows;
  return {
    profile: { memberId: first.memberId, displayName: first.displayName },
    households: rows.flatMap((row) =>
      row.householdId && row.householdName && row.role
        ? [{ householdId: row.householdId, householdName: row.householdName, role: row.role }]
        : [],
    ),
  };
}

export function ensureProfile(...args: Parameters<typeof ensureProfileImpl>) {
  return asService(() => ensureProfileImpl(...args));
}

export function loadAccess(...args: Parameters<typeof loadAccessImpl>) {
  return asService(() => loadAccessImpl(...args));
}
