"use server";

import { refresh } from "next/cache";
import { getCurrentMember } from "@/server/auth";
import { removeGoal, saveGoal } from "@/server/budget";
import type { FormState } from "../conexoes/actions";

function field(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

export async function saveGoalAction(_prevState: FormState, formData: FormData): Promise<FormState> {
  const member = await getCurrentMember();
  if (!member) {
    return { ok: false, error: "Sua conta ainda não está vinculada a uma residência." };
  }
  const result = await saveGoal(
    member,
    {
      goalId: field(formData, "goalId") || undefined,
      categoryId: field(formData, "categoryId"),
      expense: field(formData, "expense"),
      limit: field(formData, "limit"),
      thresholds: field(formData, "thresholds"),
    },
    new Date(),
  );
  if (result.ok) {
    refresh();
  }
  return result;
}

export async function removeGoalAction(_prevState: FormState, formData: FormData): Promise<FormState> {
  const member = await getCurrentMember();
  if (!member) {
    return { ok: false, error: "Sua conta ainda não está vinculada a uma residência." };
  }
  const result = await removeGoal(member, field(formData, "goalId"), new Date());
  if (result.ok) {
    refresh();
  }
  return result;
}
