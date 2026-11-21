import { describe, expect, it } from "vitest";
import { authorizationAlert, daysUntil, defaultAuthorizationExpiry } from "./authorization";

describe("autorização", () => {
  it("vale um ano a partir da autorização", () => {
    expect(defaultAuthorizationExpiry(new Date("2026-11-19T12:00:00Z"))).toEqual(new Date("2027-11-19T12:00:00Z"));
  });

  it.each([
    ["2026-12-10T12:00:00Z", 21],
    ["2026-11-20T11:00:00Z", 1],
    ["2026-11-19T12:00:00Z", 0],
    ["2026-11-18T12:00:00Z", -1],
  ])("faltam dias até %s", (data, esperado) => {
    expect(daysUntil(new Date(data), new Date("2026-11-19T12:00:00Z"))).toBe(esperado);
  });
});

describe("alerta de autorização", () => {
  const now = new Date("2026-11-19T12:00:00Z");
  const expiringIn = (days: number) => ({ status: "active", authorizationExpiresAt: new Date(now.getTime() + days * 86_400_000) });

  it.each([
    [31, null],
    [30, "warning"],
    [8, "warning"],
    [7, "danger"],
    [1, "danger"],
    [0, "expired"],
    [-3, "expired"],
  ])("faltando %i dias: %s", (days, level) => {
    expect(authorizationAlert(expiringIn(days), now)?.level ?? null).toBe(level);
  });

  it("informa os dias restantes e a data", () => {
    const connection = expiringIn(10);
    expect(authorizationAlert(connection, now)).toEqual({
      level: "warning",
      daysLeft: 10,
      expiresAt: connection.authorizationExpiresAt,
    });
  });

  it("considera expirada a conexão marcada assim pela sincronização, mesmo sem data", () => {
    expect(authorizationAlert({ status: "expired", authorizationExpiresAt: null }, now)).toEqual({ level: "expired" });
  });

  it("não alerta conexão revogada nem sem data de validade", () => {
    expect(authorizationAlert({ ...expiringIn(1), status: "revoked" }, now)).toBeNull();
    expect(authorizationAlert({ status: "active", authorizationExpiresAt: null }, now)).toBeNull();
  });
});
