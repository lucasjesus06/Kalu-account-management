import "server-only";
import { timingSafeEqual } from "node:crypto";

export function isAuthorizedCronRequest(authorization: string | null, secret = process.env.CRON_SECRET) {
  if (!secret || !authorization) {
    return false;
  }
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(authorization);
  return expected.length === received.length && timingSafeEqual(expected, received);
}
