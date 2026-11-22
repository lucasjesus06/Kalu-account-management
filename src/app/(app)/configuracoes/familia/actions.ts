"use server";

import { refresh } from "next/cache";
import { getCurrentProfile } from "@/server/auth";
import {
  createHousehold,
  createInvite,
  leaveHousehold,
  removeMember,
  revokeInvite,
  transferAdmin,
  type HouseholdResult,
} from "@/server/households";
import type { FormState } from "../../conexoes/actions";

export type InviteState = { ok: true; token: string } | { ok: false; error: string } | null;

function field(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

function finish(result: HouseholdResult, message: string): FormState {
  if (!result.ok) {
    return result;
  }
  refresh();
  return { ok: true, message };
}

export async function createHouseholdAction(_prevState: FormState, formData: FormData): Promise<FormState> {
  const profile = await getCurrentProfile();
  return finish(await createHousehold(profile.memberId, formData.get("name")), "Residência criada. Convide quem vai participar.");
}

export async function createInviteAction(_prevState: InviteState, formData: FormData): Promise<InviteState> {
  const profile = await getCurrentProfile();
  const result = await createInvite(profile.memberId, field(formData, "householdId"));
  if (result.ok) {
    refresh();
  }
  return result;
}

export async function revokeInviteAction(_prevState: FormState, formData: FormData): Promise<FormState> {
  const profile = await getCurrentProfile();
  return finish(await revokeInvite(profile.memberId, field(formData, "inviteId")), "Convite cancelado.");
}

export async function removeMemberAction(_prevState: FormState, formData: FormData): Promise<FormState> {
  const profile = await getCurrentProfile();
  return finish(
    await removeMember(profile.memberId, field(formData, "householdId"), field(formData, "memberId")),
    "Integrante removido.",
  );
}

export async function transferAdminAction(_prevState: FormState, formData: FormData): Promise<FormState> {
  const profile = await getCurrentProfile();
  return finish(
    await transferAdmin(profile.memberId, field(formData, "householdId"), field(formData, "memberId")),
    "Administração transferida.",
  );
}

export async function leaveHouseholdAction(_prevState: FormState, formData: FormData): Promise<FormState> {
  const profile = await getCurrentProfile();
  return finish(await leaveHousehold(profile.memberId, field(formData, "householdId")), "Você saiu da residência.");
}
