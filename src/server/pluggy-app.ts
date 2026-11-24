import "server-only";
import { eq } from "drizzle-orm";
import { asService, getDb } from "@/db/client";
import { pluggyCredentials } from "@/db/schema";
import { authenticate } from "@/integrations/pluggy/client";
import { decrypt } from "./crypto";

export class PluggyNotConfiguredError extends Error {}

const API_KEY_TTL_MS = 90 * 60 * 1000;

const cached = new Map<string, { apiKey: string; expiresAt: number }>();

export function pluggyAppCredentials(env: Record<string, string | undefined> = process.env) {
  const clientId = env.PLUGGY_CLIENT_ID?.trim();
  const clientSecret = env.PLUGGY_CLIENT_SECRET?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export function pluggyAppClientId() {
  return process.env.PLUGGY_CLIENT_ID?.trim() || null;
}

function findOwnCredentials(memberId: string) {
  return asService(async () => {
    const [row] = await getDb().select().from(pluggyCredentials).where(eq(pluggyCredentials.memberId, memberId));
    return row ?? null;
  });
}

export async function hasOwnCredentials(memberId: string) {
  return (await findOwnCredentials(memberId)) !== null;
}

export async function ownClientId(memberId: string) {
  return (await findOwnCredentials(memberId))?.clientId ?? null;
}

export async function pluggyClientIdFor(memberId: string) {
  return (await ownClientId(memberId)) ?? pluggyAppClientId();
}

export async function pluggyAvailableFor(memberId: string) {
  return pluggyAppCredentials() !== null || (await hasOwnCredentials(memberId));
}

async function credentialsFor(memberId?: string) {
  const own = memberId ? await findOwnCredentials(memberId) : null;
  if (own) {
    return { clientId: own.clientId, clientSecret: decrypt(own.clientSecretEncrypted) };
  }
  return pluggyAppCredentials();
}

export async function appApiKey(memberId?: string) {
  const credentials = await credentialsFor(memberId);
  if (!credentials) {
    throw new PluggyNotConfiguredError("PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET não configurados");
  }
  const hit = cached.get(credentials.clientId);
  if (hit && hit.expiresAt > Date.now()) {
    return hit.apiKey;
  }
  const apiKey = await authenticate(credentials);
  cached.set(credentials.clientId, { apiKey, expiresAt: Date.now() + API_KEY_TTL_MS });
  return apiKey;
}

export function forgetAppApiKey(clientId?: string) {
  if (clientId) {
    cached.delete(clientId);
  } else {
    cached.clear();
  }
}
