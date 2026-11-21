import { describe, expect, it } from "vitest";
import { detectChanges, hasChanged } from "./changes";

type Row = { externalId: string; amountCents: number; occurredAt: Date; billId: string | null };

const row = (externalId: string, overrides: Partial<Row> = {}): Row => ({
  externalId,
  amountCents: 1000,
  occurredAt: new Date("2026-11-10T12:00:00Z"),
  billId: null,
  ...overrides,
});

describe("detecção de mudanças", () => {
  it("separa novos, alterados e iguais", () => {
    const stored = new Map([
      ["a", row("a")],
      ["b", row("b")],
    ]);

    const changes = detectChanges([row("a"), row("b", { amountCents: 1500 }), row("c")], stored, (r) => r.externalId);

    expect(changes.created.map((r) => r.externalId)).toEqual(["c"]);
    expect(changes.updated.map((r) => r.externalId)).toEqual(["b"]);
    expect(changes.unchanged).toBe(1);
  });

  it("compara datas pelo instante, não pela instância", () => {
    expect(hasChanged(row("a"), row("a", { occurredAt: new Date("2026-11-10T09:00:00-03:00") }))).toBe(false);
    expect(hasChanged(row("a"), row("a", { occurredAt: new Date("2026-11-10T12:00:01Z") }))).toBe(true);
  });

  it("trata nulo como valor diferente de preenchido", () => {
    expect(hasChanged(row("a", { billId: "fatura-1" }), row("a"))).toBe(true);
    expect(hasChanged(row("a"), row("a", { billId: "fatura-1" }))).toBe(true);
  });

  it("ignora campos guardados que não vêm da fonte", () => {
    const stored = { ...row("a"), id: "uuid-interno" };
    expect(hasChanged(row("a"), stored)).toBe(false);
  });
});
