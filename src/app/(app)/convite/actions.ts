"use server";

import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/server/auth";
import { acceptInvite } from "@/server/households";
import type { FormState } from "../conexoes/actions";

export async function acceptInviteAction(_prevState: FormState, formData: FormData): Promise<FormState> {
  const profile = await getCurrentProfile();
  const result = await acceptInvite(profile.memberId, String(formData.get("token") ?? ""));
  if (!result.ok) {
    return result;
  }
  redirect("/configuracoes/familia");
}
