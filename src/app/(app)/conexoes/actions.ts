"use server";

import { refresh } from "next/cache";
import { formatTransactionChanges } from "@/lib/format";
import { getCurrentProfile } from "@/server/auth";
import {
  listConnections,
  registerConnectedItem,
  startConnectSession,
  type ActionResult,
  type ConnectSession,
} from "@/server/connections";
import { shareAccount } from "@/server/sharing";
import { syncConnection } from "@/server/sync";
import { registerWebhook } from "@/server/webhook-registration";

export type FormState = ActionResult | null;

function field(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

export async function syncConnectionAction(_prevState: FormState, formData: FormData): Promise<FormState> {
  const member = await getCurrentProfile();

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
  return { ok: true, message: `Sincronizado: ${formatTransactionChanges(result.changes)}.` };
}

export async function shareAccountAction(_prevState: FormState, formData: FormData): Promise<FormState> {
  const member = await getCurrentProfile();

  const result = await shareAccount(member.memberId, field(formData, "accountId"), field(formData, "householdId"));
  if (result.ok) {
    refresh();
  }
  return result;
}

export async function startConnectAction(renewConnectionId?: string): Promise<ConnectSession> {
  const member = await getCurrentProfile();
  return startConnectSession(member.memberId, renewConnectionId);
}

export async function finishConnectAction(itemId: string, renewConnectionId?: string): Promise<FormState> {
  const member = await getCurrentProfile();

  const registered = await registerConnectedItem(member.memberId, itemId, renewConnectionId);
  if (!registered.ok) {
    return registered;
  }

  const sync = await syncConnection(registered.connectionId);
  await registerWebhook().catch(() => undefined);
  refresh();
  if (!sync.ok) {
    return {
      ok: true,
      message: `${registered.message} A primeira sincronização não foi concluída: ${sync.error} Tente em “Sincronizar agora”.`,
    };
  }
  return { ok: true, message: `${registered.message} Sincronizado: ${formatTransactionChanges(sync.changes)}.` };
}
