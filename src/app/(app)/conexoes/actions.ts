"use server";

import { refresh } from "next/cache";
import { getCurrentMember } from "@/server/auth";
import { addConnection, listConnections, saveCredentials, type ActionResult } from "@/server/connections";
import { syncConnection } from "@/server/sync";

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

function plural(total: number, singular: string, pluralForm: string) {
  return `${total} ${total === 1 ? singular : pluralForm}`;
}

export async function syncConnectionAction(_prevState: FormState, formData: FormData): Promise<FormState> {
  const member = await getCurrentMember();
  if (!member) {
    return NOT_LINKED;
  }

  const connectionId = field(formData, "connectionId");
  const ownConnections = await listConnections(member.memberId);
  if (!ownConnections.some((connection) => connection.id === connectionId)) {
    return { ok: false, error: "Só o titular pode sincronizar esta conexão." };
  }

  const result = await syncConnection(connectionId);
  refresh();

  if (!result.ok) {
    return result;
  }
  return {
    ok: true,
    message: `Sincronizado: ${plural(result.accounts, "conta", "contas")}, ${plural(result.bills, "fatura", "faturas")} e ${plural(result.transactions, "transação", "transações")}.`,
  };
}
