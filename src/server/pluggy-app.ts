import "server-only";
import { authenticate } from "@/integrations/pluggy/client";

export class PluggyNotConfiguredError extends Error {}

const API_KEY_TTL_MS = 90 * 60 * 1000;

let cached: { clientId: string; apiKey: string; expiresAt: number } | null = null;

export function pluggyAppCredentials(env: Record<string, string | undefined> = process.env) {
  const clientId = env.PLUGGY_CLIENT_ID?.trim();
  const clientSecret = env.PLUGGY_CLIENT_SECRET?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export function pluggyAppClientId() {
  return process.env.PLUGGY_CLIENT_ID?.trim() || null;
}

export async function appApiKey() {
  const credentials = pluggyAppCredentials();
  if (!credentials) {
    throw new PluggyNotConfiguredError("PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET não configurados");
  }
  if (cached && cached.clientId === credentials.clientId && cached.expiresAt > Date.now()) {
    return cached.apiKey;
  }
  const apiKey = await authenticate(credentials);
  cached = { clientId: credentials.clientId, apiKey, expiresAt: Date.now() + API_KEY_TTL_MS };
  return apiKey;
}

export function forgetAppApiKey() {
  cached = null;
}
