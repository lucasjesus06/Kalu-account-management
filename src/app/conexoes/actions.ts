"use server";

import { refresh } from "next/cache";
import { getCurrentMember } from "@/server/auth";
import { addConnection, saveCredentials, type ActionResult } from "@/server/connections";

export type FormState = ActionResult | null;

const NOT_LINKED: ActionResult = {
  ok: false,
  error: "Sua conta ainda não está vinculada a uma residência.",
};

function field(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

export async function saveCredentialsAction(_prevState: FormState, formData: FormData): Promise<FormState> {
  const member = await getCurrentMember();
  if (!member) {
    return NOT_LINKED;
  }

  const result = await saveCredentials(member.memberId, field(formData, "clientId"), field(formData, "clientSecret"));
  if (result.ok) {
    refresh();
  }
  return result;
}

export async function addConnectionAction(_prevState: FormState, formData: FormData): Promise<FormState> {
  const member = await getCurrentMember();
  if (!member) {
    return NOT_LINKED;
  }

  const result = await addConnection(member.memberId, field(formData, "itemId"));
  if (result.ok) {
    refresh();
  }
  return result;
}
