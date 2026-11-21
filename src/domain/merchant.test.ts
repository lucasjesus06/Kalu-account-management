import { describe, expect, it } from "vitest";
import { merchantName, normalizeDescription } from "./merchant";

describe("normalização da descrição", () => {
  it.each([
    ["DL*99 RIDE", "DL*99 RIDE"],
    ["DL*99 Ride", "DL*99 RIDE"],
    ["DL          *UberRides", "DL*UBERRIDES"],
    ["UBER * PENDING", "UBER"],
    ["  Padaria   São   João ", "PADARIA SAO JOAO"],
    ["PARC=103 LOJA TESTE", "LOJA TESTE"],
  ])("%s → %s", (description, expected) => {
    expect(normalizeDescription(description)).toBe(expected);
  });
});

describe("nome do estabelecimento", () => {
  it.each([
    ["DL*99 RIDE", "99 RIDE"],
    ["DL*99 Ride", "99 RIDE"],
    ["DL          *UberRides", "UBERRIDES"],
    ["DL*UberRides", "UBERRIDES"],
    ["UBER * PENDING", "UBER"],
    ["KEETABR*Restaurante Teste", "RESTAURANTE TESTE"],
    ["IFD*COMPANHIA TESTE", "COMPANHIA TESTE"],
    ["PAYPAL *SPOTIFY", "SPOTIFY"],
    ["MP *LOJA DO BAIRRO", "LOJA DO BAIRRO"],
    ["HNA*OBOTICARIO", "OBOTICARIO"],
    ["ZP*LOJA TESTE", "LOJA TESTE"],
    ["APPLE.COM/BILL", "APPLE.COM/BILL"],
    ["LOJA TESTE PARC 02/03", "LOJA TESTE"],
    ["LOJA TESTE 02/03", "LOJA TESTE"],
  ])("%s → %s", (description, expected) => {
    expect(merchantName(description)).toBe(expected);
  });

  it("mantém a descrição normalizada quando não sobra nome depois do intermediador", () => {
    expect(merchantName("DL*")).toBe("DL");
  });
});
