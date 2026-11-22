import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { displayNameFromEmail } from "@/domain/household";
import { resolveScope, SCOPE_COOKIE, type Scope } from "@/domain/scope";
import { bindRequestMember } from "@/db/client";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Editor } from "./expense-nature";
import { ensureProfile, listHouseholdLinks, type HouseholdLink, type Profile } from "./profiles";

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
  const profile = await ensureProfile(userId, displayNameFromEmail(email));
  await bindRequestMember(profile.memberId);
  return profile;
}

export type CurrentContext = {
  profile: CurrentProfile;
  households: HouseholdLink[];
  scope: Scope;
  household: HouseholdLink | null;
  editor: Editor;
};

export async function getCurrentContext(): Promise<CurrentContext> {
  const profile = await getCurrentProfile();
  const households = await listHouseholdLinks(profile.memberId);
  const choice = (await cookies()).get(SCOPE_COOKIE)?.value;
  const scope = resolveScope(
    choice,
    profile.memberId,
    households.map((link) => link.householdId),
  );
  const household = scope.kind === "household" ? (households.find((link) => link.householdId === scope.householdId) ?? null) : null;
  return {
    profile,
    households,
    scope,
    household,
    editor: { memberId: profile.memberId, householdId: household?.householdId ?? null },
  };
}

export async function getCurrentMember(): Promise<CurrentMember | null> {
  const { profile, households, household } = await getCurrentContext();
  const link = household ?? households[0];
  return link ? { ...profile, householdId: link.householdId, householdName: link.householdName } : null;
}

export { listHouseholdMembers } from "./profiles";

export async function getAccountEmail() {
  return (await getAuthenticatedUser()).email;
}
