export type PushSubscriptionInput = { endpoint: string; p256dh: string; auth: string };

const MAX_FIELD = 1024;

export function parsePushSubscription(input: unknown): PushSubscriptionInput | null {
  if (typeof input !== "object" || input === null) {
    return null;
  }
  const { endpoint, keys } = input as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } | null };
  if (typeof endpoint !== "string" || typeof keys?.p256dh !== "string" || typeof keys.auth !== "string") {
    return null;
  }
  if (!endpoint || endpoint.length > MAX_FIELD || !keys.p256dh || keys.p256dh.length > MAX_FIELD || !keys.auth || keys.auth.length > MAX_FIELD) {
    return null;
  }
  try {
    if (new URL(endpoint).protocol !== "https:") {
      return null;
    }
  } catch {
    return null;
  }
  return { endpoint, p256dh: keys.p256dh, auth: keys.auth };
}
