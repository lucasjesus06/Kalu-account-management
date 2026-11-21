import "server-only";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { householdMembers, households } from "@/db/schema";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type CurrentMember = {
  memberId: string;
  displayName: string;
  householdId: string;
  householdName: string;
};

async function getAuthenticatedUserId() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) {
    redirect("/login");
  }
  return userId;
}

export async function getCurrentMember(): Promise<CurrentMember | null> {
  const userId = await getAuthenticatedUserId();

  const [member] = await getDb()
    .select({
      memberId: householdMembers.id,
      displayName: householdMembers.displayName,
      householdId: households.id,
      householdName: households.name,
    })
    .from(householdMembers)
    .innerJoin(households, eq(households.id, householdMembers.householdId))
    .where(eq(householdMembers.userId, userId))
    .limit(1);

  return member ?? null;
}

export async function listHouseholdMembers(householdId: string) {
  return getDb()
    .select({ id: householdMembers.id, displayName: householdMembers.displayName })
    .from(householdMembers)
    .where(eq(householdMembers.householdId, householdId))
    .orderBy(householdMembers.createdAt);
}
