"use server";

import { refresh } from "next/cache";
import { changePassword, renameProfile } from "@/server/account";
import { getAccountEmail, getCurrentProfile } from "@/server/auth";
import type { FormState } from "../../conexoes/actions";

function field(formData: FormData, name: string) {
  return String(formData.get(name) ?? "");
}

export async function renameProfileAction(_prevState: FormState, formData: FormData): Promise<FormState> {
  const profile = await getCurrentProfile();
  const result = await renameProfile(profile.memberId, field(formData, "name"));
  if (result.ok) {
    refresh();
  }
  return result;
}

export async function changePasswordAction(_prevState: FormState, formData: FormData): Promise<FormState> {
  const email = await getAccountEmail();
  return changePassword(email, field(formData, "current"), field(formData, "next"), field(formData, "confirmation"));
}
