"use server";

import { refresh } from "next/cache";
import { getCurrentMember } from "@/server/auth";
import { correctCategory, correctionScopes, type CorrectionScope } from "@/server/categorization";
import type { FormState } from "../../conexoes/actions";

function field(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

export async function correctCategoryAction(_prevState: FormState, formData: FormData): Promise<FormState> {
  const member = await getCurrentMember();
  if (!member) {
    return { ok: false, error: "Sua conta ainda não está vinculada a uma residência." };
  }

  const scope = field(formData, "scope");
  if (!correctionScopes.includes(scope as CorrectionScope)) {
    return { ok: false, error: "Escolha onde aplicar a categoria." };
  }

  const result = await correctCategory(
    member,
    field(formData, "transactionId"),
    field(formData, "categoryId") || null,
    scope as CorrectionScope,
  );
  if (result.ok) {
    refresh();
  }
  return result;
}
