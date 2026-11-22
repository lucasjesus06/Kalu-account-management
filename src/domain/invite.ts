export const INVITE_TTL_DAYS = 7;
export const HOUSEHOLD_NAME_MAX = 60;

export type InviteStatus = "usable" | "used" | "revoked" | "expired";

export function inviteExpiry(now: Date) {
  return new Date(now.getTime() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
}

export function inviteStatus(
  invite: { expiresAt: Date; usedAt: Date | null; revokedAt: Date | null },
  now: Date,
): InviteStatus {
  if (invite.usedAt) {
    return "used";
  }
  if (invite.revokedAt) {
    return "revoked";
  }
  return invite.expiresAt.getTime() <= now.getTime() ? "expired" : "usable";
}

export function parseHouseholdName(value: unknown) {
  const name = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  return name.length > 0 && name.length <= HOUSEHOLD_NAME_MAX ? name : null;
}

export function safeNextPath(value: unknown) {
  return typeof value === "string" && /^\/[A-Za-z0-9_\-/?=&]*$/.test(value) && !value.startsWith("//") ? value : "/";
}
