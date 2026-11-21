export const MEU_PLUGGY_AUTHORIZATION_DAYS = 365;

const DAY_MS = 24 * 60 * 60 * 1000;

export function defaultAuthorizationExpiry(authorizedAt: Date) {
  return new Date(authorizedAt.getTime() + MEU_PLUGGY_AUTHORIZATION_DAYS * DAY_MS);
}

export function daysUntil(date: Date, now: Date) {
  return Math.ceil((date.getTime() - now.getTime()) / DAY_MS);
}
