import { describe, expect, it } from "vitest";
import { categorize } from "./categorization";

const byDescription = (description: string) => categorize({ description, providerCategory: null })?.slug ?? null;

describe("categorização automática", () => {
  it.each([
    ["DL*99 RIDE", "transporte-por-aplicativo"],
    ["DL*99 Ride", "transporte-por-aplicativo"],
    ["DL          *UberRides", "transporte-por-aplicativo"],
    ["DL*UberRides", "transporte-por-aplicativo"],
    ["UBER * PENDING", "transporte-por-aplicativo"],
    ["UBER *TRIP", "transporte-por-aplicativo"],
    ["UBER *EATS", "restaurantes"],
    ["IFD*COMPANHIA TESTE", "restaurantes"],
    ["KEETABR*Restaurante Teste", "restaurantes"],
    ["IFOOD *PEDIDO", "restaurantes"],
    ["MCDONALDS PAULISTA", "fast-food"],
    ["NETFLIX.COM", "assinaturas"],
    ["PAYPAL *SPOTIFY", "assinaturas"],
    ["APPLE.COM/BILL", "assinaturas"],
    ["DROGASIL 1234", "farmacia"],
    ["RAIA 123", "farmacia"],
    ["SMARTFIT OSASCO", "academia"],
    ["MERCADOLIVRE*VENDEDOR", "compras"],
    ["MP *MERCADO LIVRE", "compras"],
    ["SUPERMERCADO DIA A DIA", "supermercado"],
    ["ASSAI ATACADISTA", "supermercado"],
    ["AUTO POSTO SANTA RITA", "combustivel"],
    ["SEM PARAR", "transporte"],
    ["SABESP", "agua"],
    ["ENEL DISTRIBUICAO SP", "energia"],
    ["VIVO FIXO", "internet-telefone"],
    ["PETZ OSASCO", "pets"],
  ])("%s → %s", (description, slug) => {
    expect(byDescription(description)).toBe(slug);
  });

  it.each([
    ["Same person transfer"],
    ["Same person transfer - PIX"],
    ["Same person transfer - TED"],
  ])("trata %s da fonte como transferência entre contas próprias", (providerCategory) => {
    expect(categorize({ description: "PIX ENVIADO LUCAS", providerCategory })).toEqual({
      slug: "transferencia-entre-contas-proprias",
      matchedBy: "provider",
    });
  });

  it.each(["PIX ENVIADO MESMA TITULARIDADE", "TRANSF ENTRE CONTAS", "TRANSFERENCIA ENTRE CONTAS"])(
    "reconhece transferência entre contas próprias pela descrição: %s",
    (description) => {
      expect(byDescription(description)).toBe("transferencia-entre-contas-proprias");
    },
  );

  it("usa a categoria da fonte quando nenhum estabelecimento conhecido corresponde", () => {
    expect(categorize({ description: "LOJA TESTE", providerCategory: "Shopping" })).toEqual({
      slug: "compras",
      matchedBy: "provider",
    });
  });

  it("o estabelecimento conhecido vence a categoria da fonte", () => {
    expect(categorize({ description: "DROGASIL", providerCategory: "Shopping" })).toEqual({
      slug: "farmacia",
      matchedBy: "merchant",
    });
  });

  it.each([
    ["PAGAMENTO DE FATURA", "Credit card payment"],
    ["PIX ENVIADO FULANO", "Transfer - PIX"],
    ["SALARIO", "Salary"],
    ["LOJA DESCONHECIDA", null],
  ])("deixa sem categoria quando não há confiança: %s", (description, providerCategory) => {
    expect(categorize({ description, providerCategory })).toBeNull();
  });

  it("não confunde palavras que só contêm o nome de uma marca", () => {
    expect(byDescription("TIMBERLAND")).toBeNull();
    expect(byDescription("ENELTRONICA")).toBeNull();
  });
});
