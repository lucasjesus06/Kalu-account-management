import { describe, expect, it } from "vitest";
import { inviteExpiry, inviteStatus, parseHouseholdName, safeNextPath } from "./invite";

const NOW = new Date("2026-11-22T12:00:00Z");

describe("convite", () => {
  it("expira em 7 dias", () => {
    expect(inviteExpiry(NOW).toISOString()).toBe("2026-11-29T12:00:00.000Z");
  });

  it("classifica o estado do convite", () => {
    const base = { expiresAt: inviteExpiry(NOW), usedAt: null, revokedAt: null };
    expect(inviteStatus(base, NOW)).toBe("usable");
    expect(inviteStatus(base, new Date("2026-11-29T12:00:00Z"))).toBe("expired");
    expect(inviteStatus({ ...base, revokedAt: NOW }, NOW)).toBe("revoked");
    expect(inviteStatus({ ...base, usedAt: NOW, revokedAt: NOW }, NOW)).toBe("used");
  });

  it("valida o nome da residência", () => {
    expect(parseHouseholdName("  Casa   da Praia ")).toBe("Casa da Praia");
    expect(parseHouseholdName("   ")).toBeNull();
    expect(parseHouseholdName("x".repeat(61))).toBeNull();
    expect(parseHouseholdName(undefined)).toBeNull();
  });

  it("só aceita caminhos internos como destino do login", () => {
    expect(safeNextPath("/convite/abc_DEF-1")).toBe("/convite/abc_DEF-1");
    expect(safeNextPath("//evil.com")).toBe("/");
    expect(safeNextPath("https://evil.com")).toBe("/");
    expect(safeNextPath("/convite?codigo=abc_DEF-1")).toBe("/convite?codigo=abc_DEF-1");
    expect(safeNextPath("/a b")).toBe("/");
    expect(safeNextPath("/\\evil.com")).toBe("/");
    expect(safeNextPath(undefined)).toBe("/");
  });
});
