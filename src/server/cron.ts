import "server-only";
import { safeEqual } from "./secrets";

export function isAuthorizedCronRequest(authorization: string | null, secret = process.env.CRON_SECRET) {
  if (!secret || !authorization) {
    return false;
  }
  return safeEqual(`Bearer ${secret}`, authorization);
}
