import "server-only";
import { and, asc, eq, max, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { integrationConnections, pluggyCredentials, webhookEvents } from "@/db/schema";
import {
  authenticate,
  createConnectToken,
  getItem,
  PluggyAuthError,
  PluggyNotFoundError,
} from "@/integrations/pluggy/client";
import { defaultAuthorizationExpiry } from "@/domain/authorization";
import { decrypt, encrypt } from "./crypto";

export type ActionResult = { ok: true; message: string } | { ok: false; error: string };

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PLUGGY_UNAVAILABLE = "Não foi possível falar com a Pluggy agora. Tente novamente em instantes.";

export async function getCredentialsSummary(memberId: string) {
  const db = getDb();
  const [[credentials], [lastEvent]] = await Promise.all([
    db
      .select({
        clientId: pluggyCredentials.clientId,
        updatedAt: pluggyCredentials.updatedAt,
        webhookRegisteredAt: pluggyCredentials.webhookRegisteredAt,
      })
      .from(pluggyCredentials)
      .where(eq(pluggyCredentials.memberId, memberId))
      .limit(1),
    db
      .select({ receivedAt: max(webhookEvents.receivedAt) })
      .from(webhookEvents)
      .innerJoin(integrationConnections, eq(integrationConnections.id, webhookEvents.connectionId))
      .where(eq(integrationConnections.memberId, memberId)),
  ]);
  return credentials ? { ...credentials, lastWebhookAt: lastEvent?.receivedAt ?? null } : null;
}

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

export async function saveCredentials(
  memberId: string,
  clientId: string,
  clientSecret: string,
): Promise<ActionResult> {
  if (!UUID_PATTERN.test(clientId)) {
    return { ok: false, error: "O Client ID precisa estar no formato xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx." };
  }
  if (!clientSecret) {
    return { ok: false, error: "Informe o Client Secret." };
  }

  try {
    await authenticate({ clientId, clientSecret });
  } catch (error) {
    if (error instanceof PluggyAuthError) {
      return { ok: false, error: "A Pluggy recusou essas credenciais. Confira o Client ID e o Client Secret." };
    }
    console.error("Falha ao validar credenciais na Pluggy", error);
    return { ok: false, error: PLUGGY_UNAVAILABLE };
  }

  const clientSecretEncrypted = encrypt(clientSecret);
  await getDb()
    .insert(pluggyCredentials)
    .values({ memberId, clientId, clientSecretEncrypted })
    .onConflictDoUpdate({
      target: pluggyCredentials.memberId,
      set: {
        clientId,
        clientSecretEncrypted,
        webhookId: sql`case when ${pluggyCredentials.clientId} = excluded.client_id then ${pluggyCredentials.webhookId} end`,
        webhookRegisteredAt: sql`case when ${pluggyCredentials.clientId} = excluded.client_id then ${pluggyCredentials.webhookRegisteredAt} end`,
        updatedAt: new Date(),
      },
    });

  return { ok: true, message: "Credenciais validadas na Pluggy e salvas." };
}

export async function loadApiKey(memberId: string) {
  const [credentials] = await getDb()
    .select()
    .from(pluggyCredentials)
    .where(eq(pluggyCredentials.memberId, memberId))
    .limit(1);
  if (!credentials) {
    return null;
  }
  return authenticate({ clientId: credentials.clientId, clientSecret: decrypt(credentials.clientSecretEncrypted) });
}

function pluggyFailure(error: unknown, notFound: string): { ok: false; error: string } {
  if (error instanceof PluggyAuthError) {
    return { ok: false, error: "Suas credenciais deixaram de ser aceitas pela Pluggy. Cadastre-as novamente." };
  }
  if (error instanceof PluggyNotFoundError) {
    return { ok: false, error: notFound };
  }
  console.error("Falha ao falar com a Pluggy", error);
  return { ok: false, error: PLUGGY_UNAVAILABLE };
}

const MISSING_CREDENTIALS = "Cadastre suas credenciais da Pluggy antes de conectar um banco.";
const ITEM_NOT_FOUND = "Esse Item ID não foi encontrado nas suas credenciais. Confira em Connected Items, no Dashboard da Pluggy.";

async function fetchItem(memberId: string, itemId: string) {
  try {
    const apiKey = await loadApiKey(memberId);
    if (!apiKey) {
      return { ok: false as const, error: MISSING_CREDENTIALS };
    }
    const item = await getItem(apiKey, itemId);
    return {
      ok: true as const,
      institutionName: item.institutionName,
      authorizationExpiresAt: item.consentExpiresAt ?? defaultAuthorizationExpiry(new Date()),
    };
  } catch (error) {
    return pluggyFailure(error, ITEM_NOT_FOUND);
  }
}

export async function addConnection(memberId: string, itemId: string): Promise<ActionResult> {
  if (!UUID_PATTERN.test(itemId)) {
    return { ok: false, error: "O Item ID precisa estar no formato xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx." };
  }

  const item = await fetchItem(memberId, itemId);
  if (!item.ok) {
    return item;
  }

  const inserted = await getDb()
    .insert(integrationConnections)
    .values({
      memberId,
      externalItemId: itemId,
      institutionName: item.institutionName,
      authorizationExpiresAt: item.authorizationExpiresAt,
    })
    .onConflictDoNothing()
    .returning({ id: integrationConnections.id });

  if (inserted.length === 0) {
    return { ok: false, error: "Essa conexão já está cadastrada." };
  }

  return { ok: true, message: item.institutionName ? `Conexão com ${item.institutionName} adicionada.` : "Conexão adicionada." };
}

export type ConnectSession = { ok: true; connectToken: string; updateItem: string | null } | { ok: false; error: string };

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
    const apiKey = await loadApiKey(memberId);
    if (!apiKey) {
      return { ok: false, error: MISSING_CREDENTIALS };
    }
    return { ok: true, connectToken: await createConnectToken(apiKey, updateItem ?? undefined), updateItem };
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
  const item = await fetchItem(memberId, itemId);
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
