import "server-only";
import { createHmac } from "node:crypto";
import { safeEqual } from "./secrets";

export const WEBHOOK_SECRET_HEADER = "x-kalu-webhook-secret";
export const SIGNATURE_HEADER = "x-pluggy-signature";
const MAX_CLOCK_SKEW_SECONDS = 300;

export type WebhookSecrets = { secret?: string; signingSecret?: string };

function configuredSecrets(): WebhookSecrets {
  return { secret: process.env.PLUGGY_WEBHOOK_SECRET, signingSecret: process.env.PLUGGY_WEBHOOK_SIGNING_SECRET };
}

export function hasValidSignature(header: string | null, rawBody: string, signingSecret: string, now = Date.now()) {
  if (!header) {
    return false;
  }
  const parts = new Map(
    header.split(",").map((part) => {
      const [key, ...value] = part.trim().split("=");
      return [key, value.join("=")] as const;
    }),
  );
  const timestamp = Number(parts.get("t"));
  const signature = parts.get("v1");
  if (!Number.isInteger(timestamp) || !signature || !/^[0-9a-f]{64}$/.test(signature)) {
    return false;
  }
  if (Math.abs(now / 1000 - timestamp) > MAX_CLOCK_SKEW_SECONDS) {
    return false;
  }
  const expected = createHmac("sha256", signingSecret).update(`${timestamp}.${rawBody}`, "utf8").digest("hex");
  return safeEqual(expected, signature);
}

export function isAuthenticWebhook(
  headers: { secret: string | null; signature: string | null },
  rawBody: string,
  secrets: WebhookSecrets = configuredSecrets(),
  now = Date.now(),
) {
  if (!secrets.secret || !headers.secret || !safeEqual(secrets.secret, headers.secret)) {
    return false;
  }
  return secrets.signingSecret ? hasValidSignature(headers.signature, rawBody, secrets.signingSecret, now) : true;
}
