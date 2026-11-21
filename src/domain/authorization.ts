export const MEU_PLUGGY_AUTHORIZATION_DAYS = 365;

const DAY_MS = 24 * 60 * 60 * 1000;

export function defaultAuthorizationExpiry(authorizedAt: Date) {
  return new Date(authorizedAt.getTime() + MEU_PLUGGY_AUTHORIZATION_DAYS * DAY_MS);
}

export function daysUntil(date: Date, now: Date) {
  return Math.ceil((date.getTime() - now.getTime()) / DAY_MS);
}

export const AUTHORIZATION_WARNING_DAYS = 30;
export const AUTHORIZATION_DANGER_DAYS = 7;

export type AuthorizationAlert =
  | { level: "expired" }
  | { level: "danger" | "warning"; daysLeft: number; expiresAt: Date };

export function authorizationAlert(
  connection: { status: string; authorizationExpiresAt: Date | null },
  now: Date,
): AuthorizationAlert | null {
  if (connection.status === "revoked") {
    return null;
  }
  if (connection.status === "expired") {
    return { level: "expired" };
  }
  if (!connection.authorizationExpiresAt) {
    return null;
  }
  const daysLeft = daysUntil(connection.authorizationExpiresAt, now);
  if (daysLeft <= 0) {
    return { level: "expired" };
  }
  if (daysLeft <= AUTHORIZATION_DANGER_DAYS) {
    return { level: "danger", daysLeft, expiresAt: connection.authorizationExpiresAt };
  }
  if (daysLeft <= AUTHORIZATION_WARNING_DAYS) {
    return { level: "warning", daysLeft, expiresAt: connection.authorizationExpiresAt };
  }
  return null;
}
