import "server-only";
import { asc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { integrationConnections, pluggyCredentials } from "@/db/schema";
import {
  authenticate,
  getItem,
  PluggyAuthError,
  PluggyNotFoundError,
} from "@/integrations/pluggy/client";
import { defaultAuthorizationExpiry } from "@/domain/authorization";
import { decrypt, encrypt } from "./crypto";

export type ActionResult = { ok: true; message: string } | { ok: false; error: string };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PLUGGY_UNAVAILABLE = "Não foi possível falar com a Pluggy agora. Tente novamente em instantes.";

export async function getCredentialsSummary(memberId: string) {
  const [credentials] = await getDb()
    .select({ clientId: pluggyCredentials.clientId, updatedAt: pluggyCredentials.updatedAt })
    .from(pluggyCredentials)
    .where(eq(pluggyCredentials.memberId, memberId))
    .limit(1);
  return credentials ?? null;
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
      set: { clientId, clientSecretEncrypted, updatedAt: new Date() },
    });

  return { ok: true, message: "Credenciais validadas na Pluggy e salvas." };
}

export async function addConnection(memberId: string, itemId: string): Promise<ActionResult> {
  if (!UUID_PATTERN.test(itemId)) {
    return { ok: false, error: "O Item ID precisa estar no formato xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx." };
  }

  const db = getDb();
  const [credentials] = await db
    .select()
    .from(pluggyCredentials)
    .where(eq(pluggyCredentials.memberId, memberId))
    .limit(1);

  if (!credentials) {
    return { ok: false, error: "Cadastre suas credenciais da Pluggy antes de adicionar uma conexão." };
  }

  let institutionName: string | null;
  let authorizationExpiresAt: Date;
  try {
    const apiKey = await authenticate({
      clientId: credentials.clientId,
      clientSecret: decrypt(credentials.clientSecretEncrypted),
    });
    const item = await getItem(apiKey, itemId);
    institutionName = item.institutionName;
    authorizationExpiresAt = item.consentExpiresAt ?? defaultAuthorizationExpiry(new Date());
  } catch (error) {
    if (error instanceof PluggyAuthError) {
      return { ok: false, error: "Suas credenciais deixaram de ser aceitas pela Pluggy. Cadastre-as novamente." };
    }
    if (error instanceof PluggyNotFoundError) {
      return { ok: false, error: "Esse Item ID não foi encontrado nas suas credenciais. Confira em Connected Items, no Dashboard da Pluggy." };
    }
    console.error("Falha ao validar item na Pluggy", error);
    return { ok: false, error: PLUGGY_UNAVAILABLE };
  }

  const inserted = await db
    .insert(integrationConnections)
    .values({ memberId, externalItemId: itemId, institutionName, authorizationExpiresAt })
    .onConflictDoNothing()
    .returning({ id: integrationConnections.id });

  if (inserted.length === 0) {
    return { ok: false, error: "Essa conexão já está cadastrada." };
  }

  return { ok: true, message: institutionName ? `Conexão com ${institutionName} adicionada.` : "Conexão adicionada." };
}
