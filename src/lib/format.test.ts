import { describe, expect, it } from "vitest";
import { formatBRL } from "./format";

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
