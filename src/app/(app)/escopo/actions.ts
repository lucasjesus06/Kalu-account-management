"use server";

import { cookies } from "next/headers";
import { refresh } from "next/cache";
import { PERSONAL_CHOICE, SCOPE_COOKIE } from "@/domain/scope";
import { getCurrentProfile } from "@/server/auth";
import { listHouseholdLinks } from "@/server/profiles";

const ONE_YEAR = 60 * 60 * 24 * 365;

export async function setScopeAction(formData: FormData) {
  const profile = await getCurrentProfile();
  const choice = String(formData.get("scope") ?? "");
  const links = await listHouseholdLinks(profile.memberId);
  if (choice !== PERSONAL_CHOICE && !links.some((link) => link.householdId === choice)) {
    return;
  }

  (await cookies()).set(SCOPE_COOKIE, choice, { path: "/", maxAge: ONE_YEAR, sameSite: "lax", httpOnly: true });
  refresh();
}
