import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { integrationConnections } from "@/db/schema";
import { createConnectToken, findConnectorId, getItem, PluggyAuthError, PluggyNotFoundError } from "@/integrations/pluggy/client";
import { defaultAuthorizationExpiry } from "@/domain/authorization";
import { appApiKey, forgetAppApiKey, PluggyNotConfiguredError } from "./pluggy-app";

export type ActionResult = { ok: true; message: string } | { ok: false; error: string };

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PLUGGY_UNAVAILABLE = "Não foi possível falar com a Pluggy agora. Tente novamente em instantes.";

export async function listConnections(memberId: string) {
  return getDb()
    .select({
      id: integrationConnections.id,
      externalItemId: integrationConnections.externalItemId,
      institutionName: integrationConnections.institutionName,
      status: integrationConnections.status,
      lastSyncedAt: integrationConnections.lastSyncedAt,
      authorizationExpiresAt: integrationConnections.authorizationExpiresAt,
      createdAt: integrationConnections.createdAt,
    })
    .from(integrationConnections)
    .where(eq(integrationConnections.memberId, memberId))
    .orderBy(asc(integrationConnections.createdAt));
}

function pluggyFailure(error: unknown, notFound: string): { ok: false; error: string } {
  if (error instanceof PluggyNotConfiguredError) {
    return { ok: false, error: "A conexão com bancos ainda não foi ativada neste ambiente." };
  }
  if (error instanceof PluggyAuthError) {
    forgetAppApiKey();
    return { ok: false, error: PLUGGY_UNAVAILABLE };
  }
  if (error instanceof PluggyNotFoundError) {
    return { ok: false, error: notFound };
  }
  console.error("Falha ao falar com a Pluggy", error);
  return { ok: false, error: PLUGGY_UNAVAILABLE };
}

const ITEM_NOT_FOUND = "Não encontramos essa conexão. Tente adicionar o banco novamente.";

async function fetchItem(itemId: string) {
  try {
    const item = await getItem(await appApiKey(), itemId);
    return {
      ok: true as const,
      institutionName: item.institutionName,
      authorizationExpiresAt: item.consentExpiresAt ?? defaultAuthorizationExpiry(new Date()),
    };
  } catch (error) {
    return pluggyFailure(error, ITEM_NOT_FOUND);
  }
}

export type ConnectSession =
  | { ok: true; connectToken: string; updateItem: string | null; connectorId: number | null }
  | { ok: false; error: string };

async function findOwnConnection(memberId: string, connectionId: string) {
  if (!UUID_PATTERN.test(connectionId)) {
    return undefined;
  }
  const [connection] = await getDb()
    .select()
    .from(integrationConnections)
    .where(and(eq(integrationConnections.id, connectionId), eq(integrationConnections.memberId, memberId)));
  return connection;
}

let meuPluggyConnectorId: number | null = null;

async function lookupMeuPluggyConnector(apiKey: string) {
  if (meuPluggyConnectorId === null) {
    meuPluggyConnectorId = await findConnectorId(apiKey, "MeuPluggy").catch(() => null);
  }
  return meuPluggyConnectorId;
}

export function forgetMeuPluggyConnector() {
  meuPluggyConnectorId = null;
}

export async function startConnectSession(memberId: string, renewConnectionId?: string): Promise<ConnectSession> {
  let updateItem: string | null = null;
  if (renewConnectionId) {
    const connection = await findOwnConnection(memberId, renewConnectionId);
    if (!connection) {
      return { ok: false, error: "Conexão não encontrada." };
    }
    updateItem = connection.externalItemId;
  }

  try {
    const apiKey = await appApiKey();
    const connectToken = await createConnectToken(apiKey, updateItem ?? undefined, memberId);
    const connectorId = updateItem ? null : await lookupMeuPluggyConnector(apiKey);
    return { ok: true, connectToken, updateItem, connectorId };
  } catch (error) {
    return pluggyFailure(error, "A conexão que você quer renovar não foi encontrada na Pluggy.");
  }
}

export type ConnectedItemResult = { ok: true; message: string; connectionId: string } | { ok: false; error: string };

export async function registerConnectedItem(
  memberId: string,
  itemId: string,
  renewConnectionId?: string,
): Promise<ConnectedItemResult> {
  if (!UUID_PATTERN.test(itemId)) {
    return { ok: false, error: "A Pluggy devolveu uma conexão inválida. Tente novamente." };
  }
  const item = await fetchItem(itemId);
  if (!item.ok) {
    return item;
  }
  const db = getDb();
  const institution = item.institutionName ?? "o banco";
  const [existing] = await db
    .select()
    .from(integrationConnections)
    .where(and(eq(integrationConnections.provider, "pluggy"), eq(integrationConnections.externalItemId, itemId)));

  let target = existing;
  if (renewConnectionId) {
    const renewed = await findOwnConnection(memberId, renewConnectionId);
    if (!renewed) {
      return { ok: false, error: "Conexão não encontrada." };
    }
    if (existing && existing.id !== renewed.id) {
      return { ok: false, error: "Esse banco já está em outra conexão do Kalu." };
    }
    target = renewed;
  } else if (existing && existing.memberId !== memberId) {
    return { ok: false, error: "Esse banco já foi conectado por outro integrante da residência." };
  }

  if (target) {
    await db
      .update(integrationConnections)
      .set({
        externalItemId: itemId,
        institutionName: item.institutionName ?? target.institutionName,
        status: "active",
        authorizationExpiresAt: item.authorizationExpiresAt,
      })
      .where(eq(integrationConnections.id, target.id));
    return { ok: true, message: `Autorização de ${item.institutionName ?? target.institutionName ?? "o banco"} renovada.`, connectionId: target.id };
  }

  const [created] = await db
    .insert(integrationConnections)
    .values({
      memberId,
      externalItemId: itemId,
      institutionName: item.institutionName,
      authorizationExpiresAt: item.authorizationExpiresAt,
    })
    .returning({ id: integrationConnections.id });
  return { ok: true, message: `Conexão com ${institution} adicionada.`, connectionId: created.id };
}
