"use server";

import { refresh } from "next/cache";
import { getCurrentMember } from "@/server/auth";
import { evaluateBudgetAlerts } from "@/server/budget";
import { correctCategory, correctionScopes, type CorrectionScope } from "@/server/categorization";
import { correctExpenseNature } from "@/server/expense-nature";
import type { FormState } from "../conexoes/actions";

function field(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

export async function classifyTransactionAction(_prevState: FormState, formData: FormData): Promise<FormState> {
  const member = await getCurrentMember();
  if (!member) {
    return { ok: false, error: "Sua conta ainda não está vinculada a uma residência." };
  }

  const scope = field(formData, "scope");
  if (!correctionScopes.includes(scope as CorrectionScope)) {
    return { ok: false, error: "Escolha onde aplicar a classificação." };
  }

  const transactionId = field(formData, "transactionId");
  const categoryId = field(formData, "categoryId");
  const expense = field(formData, "expense");
  const categoryChanged = categoryId !== field(formData, "currentCategoryId");
  const expenseChanged = expense !== field(formData, "currentExpense");
  if (!categoryChanged && !expenseChanged) {
    return { ok: false, error: "Altere a categoria ou para quem é o gasto antes de salvar." };
  }

  const messages: string[] = [];
  if (categoryChanged) {
    const result = await correctCategory(member, transactionId, categoryId || null, scope as CorrectionScope);
    if (!result.ok) {
      return result;
    }
    messages.push(result.message);
  }
  if (expenseChanged) {
    const result = await correctExpenseNature(member, transactionId, expense, scope as CorrectionScope);
    if (!result.ok) {
      refresh();
      return messages.length > 0 ? { ok: false, error: `${messages.join(" ")} ${result.error}` } : result;
    }
    messages.push(result.message);
  }
  await evaluateBudgetAlerts(member.householdId, new Date()).catch((error) => console.error("Falha ao avaliar as metas", error));
  refresh();
  return { ok: true, message: messages.join(" ") };
}
