"use server";

import { refresh } from "next/cache";
import { getCurrentContext } from "@/server/auth";
import { deleteCategoryRule, deleteNatureRule, saveCategoryRule, saveNatureRule } from "@/server/rules";
import type { FormState } from "../../conexoes/actions";

function field(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

async function run(
  target: string,
  needsHousehold: boolean,
  work: (memberId: string, householdId: string | null) => Promise<FormState>,
): Promise<FormState> {
  const { profile, household } = await getCurrentContext();
  const personal = target === "pessoal" && !needsHousehold;
  if (!personal && !household) {
    return { ok: false, error: "Esta regra fica dentro de uma residência. Escolha uma no seletor do topo." };
  }
  const result = await work(profile.memberId, personal ? null : household!.householdId);
  if (result?.ok) {
    refresh();
  }
  return result;
}

export async function saveRuleAction(_prevState: FormState, formData: FormData): Promise<FormState> {
  const applyHistory = formData.get("applyHistory") === "on";
  const nature = field(formData, "kind") === "nature";
  return run(field(formData, "target"), nature, (memberId, householdId) =>
    nature
      ? saveNatureRule(memberId, householdId!, formData.get("merchant"), field(formData, "expense"), applyHistory)
      : saveCategoryRule(memberId, householdId, formData.get("merchant"), field(formData, "categoryId"), applyHistory),
  );
}

export async function changeRuleAction(_prevState: FormState, formData: FormData): Promise<FormState> {
  const nature = field(formData, "kind") === "nature";
  return run(field(formData, "target"), nature, (memberId, householdId) =>
    nature
      ? saveNatureRule(memberId, householdId!, formData.get("merchant"), field(formData, "expense"), true)
      : saveCategoryRule(memberId, householdId, formData.get("merchant"), field(formData, "categoryId"), true),
  );
}

export async function deleteRuleAction(_prevState: FormState, formData: FormData): Promise<FormState> {
  const kind = field(formData, "kind");
  const ruleId = field(formData, "ruleId");
  return run(field(formData, "target"), false, (memberId) =>
    kind === "nature" ? deleteNatureRule(memberId, ruleId) : deleteCategoryRule(memberId, ruleId),
  );
}
