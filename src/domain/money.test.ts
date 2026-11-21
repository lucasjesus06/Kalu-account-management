import { describe, expect, it } from "vitest";
import { fromCents, toCents } from "./money";

describe("toCents", () => {
  it.each([
    [4034.77, 403477],
    [7992.75, 799275],
    [0.1 + 0.2, 30],
    [-6365.17, -636517],
    [0.005, 1],
    [-0.001, 0],
    [0, 0],
  ])("converte %d em %i centavos", (valor, esperado) => {
    expect(toCents(valor)).toBe(esperado);
  });

  it("evita o erro de soma de ponto flutuante", () => {
    const parcelas = [1220.67, 366.2, 104.9];
    const somaEmCentavos = parcelas.map(toCents).reduce((total, valor) => total + valor, 0);
    expect(somaEmCentavos).toBe(169177);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY])("rejeita %d", (valor) => {
    expect(() => toCents(valor)).toThrow("Valor monetário inválido");
  });
});

describe("fromCents", () => {
  it("volta para reais", () => {
    expect(fromCents(403477)).toBe(4034.77);
  });
});
