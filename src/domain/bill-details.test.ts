import { describe, expect, it } from "vitest";
import {
  creditLines,
  futureInstallments,
  groupByCategory,
  paymentStatus,
  topMerchants,
  type BillLine,
} from "./bill-details";

const restaurantes = { slug: "restaurantes", name: "Restaurantes e delivery", kind: "expense" as const };
const mercado = { slug: "supermercado", name: "Supermercado", kind: "expense" as const };
const transferencia = { slug: "transferencia-entre-integrantes", name: "Transferência entre integrantes", kind: "transfer" as const };

let sequence = 0;
function line(amountCents: number, overrides: Partial<BillLine> = {}): BillLine {
  sequence += 1;
  return {
    id: `t${sequence}`,
    amountCents,
    direction: "outflow",
    status: "posted",
    description: "COMPRA",
    providerCategory: null,
    billExternalId: "fatura",
    occurredAt: new Date(Date.UTC(2026, 9, sequence)),
    merchantName: "LOJA",
    category: null,
    categorySource: null,
    installmentNumber: null,
    installmentTotal: null,
    ...overrides,
  };
}

const payment = line(636517, { direction: "inflow", description: "PAGAMENTO DE FATURA", merchantName: "PAGAMENTO DE FATURA" });
const lines = [
  line(10000, { category: mercado, merchantName: "ASSAI" }),
  line(25000, { category: mercado, merchantName: "CARREFOUR" }),
  line(4000, { category: restaurantes, merchantName: "COMPANHIA TESTE" }),
  line(1500, { category: restaurantes, merchantName: "COMPANHIA TESTE", direction: "inflow", description: "IFD*COMPANHIA TESTE" }),
  line(3000, { merchantName: "LOJA DESCONHECIDA" }),
  line(12000, { category: mercado, merchantName: "ASSAI", installmentNumber: 1, installmentTotal: 3 }),
  line(5000, { merchantName: "LOJA PARCELADA", installmentNumber: 3, installmentTotal: 3 }),
  line(60000, { category: transferencia, merchantName: "KARINA" }),
  payment,
];
const totals = [636517];

describe("distribuição por categoria", () => {
  it("soma por categoria: consumo do maior para o menor, depois sem categoria e por fim transferências", () => {
    const groups = groupByCategory(lines, totals);

    expect(groups.map((g) => [g.name, g.kind, g.netCents, g.count])).toEqual([
      ["Supermercado", "expense", 47000, 3],
      ["Restaurantes e delivery", "expense", 2500, 2],
      ["Sem categoria", null, 8000, 2],
      ["Transferência entre integrantes", "transfer", 60000, 1],
    ]);
  });

  it("não inclui o pagamento da fatura anterior", () => {
    const groups = groupByCategory(lines, totals);

    expect(groups.flatMap((g) => g.lines)).not.toContain(payment);
  });

  it("lista as transações de cada categoria da mais recente para a mais antiga", () => {
    const [supermercado] = groupByCategory(lines, totals);

    const dates = supermercado.lines.map((l) => l.occurredAt.getTime());
    expect(dates).toEqual([...dates].sort((a, b) => b - a));
  });
});

describe("estabelecimentos com maior participação", () => {
  it("agrupa pelo estabelecimento normalizado, desconta créditos e ignora transferências", () => {
    expect(topMerchants(lines, totals, 3)).toEqual([
      { name: "CARREFOUR", netCents: 25000, count: 1 },
      { name: "ASSAI", netCents: 22000, count: 2 },
      { name: "LOJA PARCELADA", netCents: 5000, count: 1 },
    ]);
  });
});

describe("créditos e estornos", () => {
  it("separa os créditos do pagamento de fatura", () => {
    expect(creditLines(lines, totals).map((l) => l.merchantName)).toEqual(["COMPANHIA TESTE"]);
  });
});

describe("parcelas futuras", () => {
  it("calcula as parcelas restantes das compras parceladas ainda não quitadas", () => {
    const future = futureInstallments(lines, totals);

    expect(future.map((f) => [f.line.merchantName, f.remaining, f.remainingCents])).toEqual([["ASSAI", 2, 24000]]);
  });
});

describe("situação do pagamento", () => {
  it.each([
    [403477, 403477, "paid"],
    [604326, 604321, "paid"],
    [403477, 200000, "partially_paid"],
    [403477, 0, "unpaid"],
  ])("fatura de %i com %i pago: %s", (total, paid, status) => {
    expect(paymentStatus(total, paid)).toBe(status);
  });
});
