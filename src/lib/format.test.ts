import { describe, expect, it } from "vitest";
import {
  formatBRL,
  formatDate,
  formatDateTime,
  formatIsoDate,
  formatMonth,
  formatPercent,
  formatPeriod,
  formatTransactionChanges,
} from "./format";

const semEspacoEspecial = (texto: string) => texto.replace(/\s/g, " ");

describe("formatBRL", () => {
  it.each([
    [4034.77, "R$ 4.034,77"],
    [0, "R$ 0,00"],
    [7.2, "R$ 7,20"],
    [1234567.891, "R$ 1.234.567,89"],
    [-727.4, "-R$ 727,40"],
    [-0, "R$ 0,00"],
  ])("formata %d como %s", (valor, esperado) => {
    expect(semEspacoEspecial(formatBRL(valor))).toBe(esperado);
  });
});

describe("datas", () => {
  it("formata no fuso de São Paulo", () => {
    const meiaNoiteUtc = new Date("2026-11-22T02:30:00.000Z");
    expect(formatDate(meiaNoiteUtc)).toBe("21/11/2026");
    expect(formatDateTime(meiaNoiteUtc)).toBe("21/11/2026 às 23:30");
  });
});

describe("formatTransactionChanges", () => {
  it.each([
    [{ created: 0, updated: 0, removed: 0 }, "nenhuma transação nova ou alterada"],
    [{ created: 1, updated: 0, removed: 0 }, "1 transação nova"],
    [{ created: 3, updated: 1, removed: 0 }, "3 transações novas e 1 alterada"],
    [{ created: 0, updated: 2, removed: 1 }, "2 transações alteradas e 1 removida"],
    [{ created: 4, updated: 2, removed: 1 }, "4 transações novas, 2 alteradas e 1 removida"],
  ])("descreve %o", (changes, esperado) => {
    expect(formatTransactionChanges(changes)).toBe(esperado);
  });
});

describe("formatIsoDate", () => {
  it("formata a data sem converter fuso horário", () => {
    expect(formatIsoDate("2026-11-03")).toBe("03/11/2026");
  });
});

describe("formatMonth", () => {
  it.each([
    ["2026-11", "novembro de 2026"],
    ["2026-01", "janeiro de 2026"],
  ])("%s → %s", (month, expected) => {
    expect(formatMonth(month)).toBe(expected);
  });
});

describe("formatPeriod", () => {
  it("mostra o primeiro e o último dia do período, com o fim exclusivo", () => {
    expect(
      formatPeriod({ start: new Date("2026-11-01T00:00:00-03:00"), end: new Date("2026-12-01T00:00:00-03:00") }),
    ).toBe("01/11 a 30/11");
  });
});

describe("formatPercent", () => {
  it.each([
    [20, "20%"],
    [-12.345, "-12,3%"],
  ])("%d → %s", (value, expected) => {
    expect(formatPercent(value)).toBe(expected);
  });
});
