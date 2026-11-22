import "server-only";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getDb } from "@/db/client";
import { householdMembers } from "@/db/schema";
import { displayNameFromEmail } from "@/domain/household";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ensureProfile, listHouseholdLinks, type Profile } from "./profiles";

export type CurrentProfile = Profile;

export type CurrentMember = CurrentProfile & {
  householdId: string;
  householdName: string;
};

async function getAuthenticatedUser() {
  await connection();
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) {
    redirect("/login");
  }
  const email = typeof data?.claims?.email === "string" ? data.claims.email : null;
  return { userId, email };
}

export async function getCurrentProfile(): Promise<CurrentProfile> {
  const { userId, email } = await getAuthenticatedUser();
  return ensureProfile(userId, displayNameFromEmail(email));
}

export async function getCurrentMember(): Promise<CurrentMember | null> {
  const profile = await getCurrentProfile();
  const [link] = await listHouseholdLinks(profile.memberId);
  return link ? { ...profile, householdId: link.householdId, householdName: link.householdName } : null;
}

export async function listHouseholdMembers(householdId: string) {
  return getDb()
    .select({ id: householdMembers.id, displayName: householdMembers.displayName })
    .from(householdMembers)
    .where(eq(householdMembers.householdId, householdId))
    .orderBy(householdMembers.createdAt);
}
