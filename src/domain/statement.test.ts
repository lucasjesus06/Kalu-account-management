import { describe, expect, it } from "vitest";
import { statementNature, summarizeStatement, type StatementLine } from "./statement";

const transferencia = { slug: "transferencia-entre-integrantes", name: "Transferência entre integrantes", kind: "transfer" as const };
const mercado = { slug: "supermercado", name: "Supermercado", kind: "expense" as const };

let sequence = 0;
function line(amountCents: number, overrides: Partial<StatementLine> = {}): StatementLine {
  sequence += 1;
  return {
    id: `t${sequence}`,
    amountCents,
    direction: "outflow",
    status: "posted",
    description: "COMPRA",
    providerCategory: null,
    occurredAt: new Date(Date.UTC(2026, 10, sequence)),
    merchantName: null,
    category: null,
    categorySource: null,
    installmentNumber: null,
    installmentTotal: null,
    ...overrides,
  };
}

describe("natureza no extrato", () => {
  it.each([
    ["saída comum", line(1000, { category: mercado }), "spending"],
    ["entrada", line(500000, { direction: "inflow", description: "SALARIO" }), "income"],
    ["pagamento de cartão pela categoria da fonte", line(403477, { providerCategory: "Credit card payment" }), "bill_payment"],
    ["pagamento de fatura pela descrição", line(403477, { description: "PAGAMENTO DE FATURA CARTAO" }), "bill_payment"],
    ["pagamento de cartão com acento", line(403477, { description: "Pagamento Cartão de Crédito" }), "bill_payment"],
    ["transferência enviada", line(20000, { category: transferencia }), "transfer"],
    ["transferência recebida", line(20000, { direction: "inflow", category: transferencia }), "transfer"],
  ])("%s", (_caso, transaction, nature) => {
    expect(statementNature(transaction)).toBe(nature);
  });

  it("não confunde pagamento comum com pagamento de fatura", () => {
    expect(statementNature(line(15000, { description: "PAGAMENTO BOLETO CONDOMINIO" }))).toBe("spending");
  });
});

describe("resumo do extrato", () => {
  it("separa entradas, gastos, pagamentos de fatura e transferências", () => {
    expect(
      summarizeStatement([
        line(500000, { direction: "inflow", description: "SALARIO" }),
        line(1000, { category: mercado }),
        line(2500),
        line(403477, { providerCategory: "Credit card payment" }),
        line(20000, { category: transferencia }),
        line(5000, { direction: "inflow", category: transferencia }),
      ]),
    ).toEqual({
      incomeCents: 500000,
      spendingCents: 3500,
      billPaymentsCents: 403477,
      transfersInCents: 5000,
      transfersOutCents: 20000,
    });
  });
});
