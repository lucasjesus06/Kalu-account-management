import { describe, expect, it } from "vitest";
import { daysUntil, defaultAuthorizationExpiry } from "./authorization";

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
