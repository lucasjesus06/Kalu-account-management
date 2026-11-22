import "server-only";
import { and, eq } from "drizzle-orm";
import { asService, getDb } from "@/db/client";
import { integrationConnections, pluggyCredentials, webhookEvents } from "@/db/schema";
import { SYNC_ALREADY_RUNNING, syncConnection } from "./sync";

export type PluggyWebhookPayload = {
  event: string;
  eventId: string;
  clientId: string | null;
  itemId: string | null;
  triggeredBy: string | null;
};

const SYNC_EVENTS = new Set([
  "item/created",
  "item/updated",
  "item/error",
  "transactions/created",
  "transactions/updated",
  "transactions/deleted",
]);

function text(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function parseWebhookPayload(rawBody: string): PluggyWebhookPayload | null {
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return null;
  }
  if (!body || typeof body !== "object") {
    return null;
  }
  const record = body as Record<string, unknown>;
  const event = text(record.event);
  const eventId = text(record.eventId);
  if (!event || !eventId) {
    return null;
  }
  return {
    event,
    eventId,
    clientId: text(record.clientId),
    itemId: text(record.itemId),
    triggeredBy: text(record.triggeredBy),
  };
}

async function recordWebhookEventImpl(payload: PluggyWebhookPayload) {
  const [recorded] = await getDb()
    .insert(webhookEvents)
    .values({
      externalEventId: payload.eventId,
      event: payload.event,
      externalItemId: payload.itemId,
      triggeredBy: payload.triggeredBy,
    })
    .onConflictDoNothing()
    .returning({ id: webhookEvents.id });
  return recorded?.id ?? null;
}

type Outcome = { result: (typeof webhookEvents.$inferInsert)["result"]; detail: string | null; connectionId: string | null };

async function decide(payload: PluggyWebhookPayload): Promise<Outcome> {
  if (!payload.itemId) {
    return { result: "ignored", detail: "Evento sem item.", connectionId: null };
  }
  const db = getDb();
  const [connection] = await db
    .select({ id: integrationConnections.id, clientId: pluggyCredentials.clientId })
    .from(integrationConnections)
    .leftJoin(pluggyCredentials, eq(pluggyCredentials.memberId, integrationConnections.memberId))
    .where(and(eq(integrationConnections.provider, "pluggy"), eq(integrationConnections.externalItemId, payload.itemId)));
  if (!connection) {
    return { result: "ignored", detail: "Item sem conexão no Kalu.", connectionId: null };
  }
  if (payload.clientId && payload.clientId !== connection.clientId) {
    return { result: "ignored", detail: "Client ID diferente do cadastrado.", connectionId: connection.id };
  }

  if (payload.event === "item/deleted") {
    await db.update(integrationConnections).set({ status: "revoked" }).where(eq(integrationConnections.id, connection.id));
    return { result: "revoked", detail: null, connectionId: connection.id };
  }
  if (!SYNC_EVENTS.has(payload.event)) {
    return { result: "ignored", detail: "Evento sem ação no Kalu.", connectionId: connection.id };
  }

  const sync = await syncConnection(connection.id);
  if (sync.ok) {
    return { result: "synced", detail: null, connectionId: connection.id };
  }
  return {
    result: sync.error === SYNC_ALREADY_RUNNING ? "ignored" : "failed",
    detail: sync.error,
    connectionId: connection.id,
  };
}

async function processWebhookEventImpl(recordId: string, payload: PluggyWebhookPayload) {
  let outcome: Outcome;
  try {
    outcome = await decide(payload);
  } catch (error) {
    console.error("Falha ao processar notificação da Pluggy", payload.eventId, error);
    outcome = { result: "failed", detail: "Falha inesperada ao processar.", connectionId: null };
  }
  await getDb()
    .update(webhookEvents)
    .set({ ...outcome, processedAt: new Date() })
    .where(eq(webhookEvents.id, recordId));
  return outcome;
}

export function recordWebhookEvent(...args: Parameters<typeof recordWebhookEventImpl>) {
  return asService(() => recordWebhookEventImpl(...args));
}

export function processWebhookEvent(...args: Parameters<typeof processWebhookEventImpl>) {
  return asService(() => processWebhookEventImpl(...args));
}
