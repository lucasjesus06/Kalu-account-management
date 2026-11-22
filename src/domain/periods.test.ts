import { describe, expect, it } from "vitest";
import { comparablePeriods, contains, daysInMonth, fullMonth, isMonth, monthOf, shiftMonth } from "./periods";

describe("períodos", () => {
  it("usa o mês de Brasília", () => {
    expect(monthOf(new Date("2026-12-01T02:30:00Z"))).toBe("2026-11");
    expect(monthOf(new Date("2026-12-01T03:00:00Z"))).toBe("2026-12");
  });

  it("desloca meses atravessando o ano", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-11", -12)).toBe("2025-11");
  });

  it("conta os dias do mês", () => {
    expect(daysInMonth("2026-02")).toBe(28);
    expect(daysInMonth("2028-02")).toBe(29);
    expect(daysInMonth("2026-10")).toBe(31);
  });

  it("o mês inteiro começa e termina à meia-noite de Brasília", () => {
    expect(fullMonth("2026-11")).toEqual({
      start: new Date("2026-11-01T00:00:00-03:00"),
      end: new Date("2026-12-01T00:00:00-03:00"),
    });
  });

  it("compara o mês corrente com o mesmo intervalo de dias do mês anterior", () => {
    const now = new Date("2026-11-22T10:00:00-03:00");

    expect(comparablePeriods("2026-11", "2026-10", now)).toEqual({
      current: { start: new Date("2026-11-01T00:00:00-03:00"), end: now },
      previous: { start: new Date("2026-10-01T00:00:00-03:00"), end: new Date("2026-10-23T00:00:00-03:00") },
      partial: true,
    });
  });

  it("limita o intervalo ao tamanho do mês comparado", () => {
    const now = new Date("2026-03-31T10:00:00-03:00");

    expect(comparablePeriods("2026-03", "2026-02", now).previous.end).toEqual(new Date("2026-03-01T00:00:00-03:00"));
  });

  it("compara meses inteiros quando o mês escolhido já terminou", () => {
    const now = new Date("2026-11-22T10:00:00-03:00");

    expect(comparablePeriods("2026-09", "2025-09", now)).toEqual({
      current: fullMonth("2026-09"),
      previous: fullMonth("2025-09"),
      partial: false,
    });
  });

  it("o fim do período é exclusivo", () => {
    const period = fullMonth("2026-11");
    expect(contains(period, new Date("2026-11-30T23:59:59-03:00"))).toBe(true);
    expect(contains(period, new Date("2026-12-01T00:00:00-03:00"))).toBe(false);
  });

  it.each([
    ["2026-11", true],
    ["2026-13", false],
    ["2026-1", false],
    [undefined, false],
  ])("valida o mês %s", (value, expected) => {
    expect(isMonth(value)).toBe(expected);
  });
});
