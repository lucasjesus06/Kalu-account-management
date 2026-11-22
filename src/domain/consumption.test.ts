import { describe, expect, it } from "vitest";
import {
  compareBreakdowns,
  consumptionNature,
  percentChange,
  summarize,
  type ConsumptionRecord,
} from "./consumption";
import { fullMonth } from "./periods";

const mercado = { slug: "supermercado", name: "Supermercado", kind: "expense" as const };
const restaurantes = { slug: "restaurantes", name: "Restaurantes e delivery", kind: "expense" as const };
const transferencia = { slug: "transferencia-entre-integrantes", name: "Transferência entre integrantes", kind: "transfer" as const };

let sequence = 0;
function record(amountCents: number, overrides: Partial<ConsumptionRecord> = {}): ConsumptionRecord {
  sequence += 1;
  return {
    id: `t${sequence}`,
    occurredAt: new Date("2026-11-10T12:00:00-03:00"),
    amountCents,
    direction: "outflow",
    status: "posted",
    description: "COMPRA",
    providerCategory: null,
    billExternalId: null,
    merchantName: "LOJA",
    category: null,
    categorySource: null,
    installmentNumber: null,
    installmentTotal: null,
    accountId: "cartao-lucas",
    accountKind: "credit_card",
    accountName: "Cartão",
    institutionName: "Santander",
    memberName: "Lucas",
    ...overrides,
  };
}

const checking = { accountId: "conta-karina", accountKind: "checking", accountName: "Conta", institutionName: "Nubank", memberName: "Karina" };
const billTotals = [403477];

describe("natureza para consumo", () => {
  it.each([
    ["compra no cartão", record(1000), "spending"],
    ["estorno no cartão", record(500, { direction: "inflow", description: "ESTORNO" }), "refund"],
    ["pagamento de fatura no cartão", record(403477, { direction: "inflow", description: "CREDITO" }), "bill_payment"],
    ["PIX no crédito marcado como transferência", record(20000, { category: transferencia }), "transfer"],
    ["gasto na conta", record(1500, checking), "spending"],
    ["entrada na conta", record(500000, { ...checking, direction: "inflow", description: "SALARIO" }), "income"],
    ["pagamento do cartão pela conta", record(403477, { ...checking, providerCategory: "Credit card payment" }), "bill_payment"],
  ])("%s", (_caso, transaction, nature) => {
    expect(consumptionNature(transaction, billTotals)).toBe(nature);
  });
});

describe("resumo do período", () => {
  const records = [
    record(10000, { category: mercado, merchantName: "ASSAI" }),
    record(30000, { category: mercado, merchantName: "CARREFOUR", status: "pending" }),
    record(8000, { category: restaurantes, merchantName: "IFOOD" }),
    record(2000, { category: restaurantes, merchantName: "IFOOD", direction: "inflow", description: "ESTORNO IFOOD" }),
    record(5000, { merchantName: "LOJA NOVA" }),
    record(1500, { ...checking, category: mercado, merchantName: "PADARIA" }),
    record(500000, { ...checking, direction: "inflow", description: "SALARIO" }),
    record(403477, { ...checking, providerCategory: "Credit card payment" }),
    record(20000, { category: transferencia }),
    record(7000, { ...checking, direction: "inflow", category: transferencia }),
    record(99999, { occurredAt: new Date("2026-10-31T23:59:00-03:00") }),
    record(88888, { occurredAt: new Date("2026-12-01T00:00:00-03:00") }),
  ];

  const summary = summarize(records, billTotals, fullMonth("2026-11"));

  it("consumo é compras menos estornos do período, sem transferências, pagamentos de fatura e entradas", () => {
    expect(summary).toMatchObject({
      consumptionCents: 10000 + 30000 + 8000 - 2000 + 5000 + 1500,
      purchasesCount: 5,
      averageTicketCents: Math.round((10000 + 30000 + 8000 + 5000 + 1500) / 5),
      refundsCents: 2000,
      refundsCount: 1,
      incomeCents: 500000,
      billPaymentsCents: 403477,
      transfersOutCents: 20000,
      transfersInCents: 7000,
      uncategorizedCents: 5000,
      uncategorizedCount: 1,
      pendingCount: 1,
    });
  });

  it("detalha por categoria, integrante, origem e estabelecimento", () => {
    expect(summary.byCategory).toEqual([
      { key: "supermercado", label: "Supermercado", totalCents: 41500, count: 3 },
      { key: "restaurantes", label: "Restaurantes e delivery", totalCents: 6000, count: 1 },
      { key: "sem-categoria", label: "Sem categoria", totalCents: 5000, count: 1 },
    ]);
    expect(summary.byMember).toEqual([
      { key: "Lucas", label: "Lucas", totalCents: 51000, count: 4 },
      { key: "Karina", label: "Karina", totalCents: 1500, count: 1 },
    ]);
    expect(summary.byOrigin.map((o) => o.label)).toEqual(["Cartão · Santander · Lucas", "Conta · Nubank · Karina"]);
    expect(summary.byMerchant[0]).toEqual({ key: "CARREFOUR", label: "CARREFOUR", totalCents: 30000, count: 1 });
  });
});

describe("comparação entre períodos", () => {
  it("junta as chaves dos dois períodos e calcula a variação", () => {
    const rows = compareBreakdowns(
      [
        { key: "mercado", label: "Supermercado", totalCents: 12000, count: 3 },
        { key: "uber", label: "Uber", totalCents: 5000, count: 4 },
      ],
      [
        { key: "mercado", label: "Supermercado", totalCents: 10000, count: 2 },
        { key: "farmacia", label: "Farmácia", totalCents: 8000, count: 1 },
      ],
    );

    expect(rows).toEqual([
      { key: "mercado", label: "Supermercado", currentCents: 12000, currentCount: 3, previousCents: 10000, previousCount: 2, deltaCents: 2000, deltaPercent: 20 },
      { key: "farmacia", label: "Farmácia", currentCents: 0, currentCount: 0, previousCents: 8000, previousCount: 1, deltaCents: -8000, deltaPercent: -100 },
      { key: "uber", label: "Uber", currentCents: 5000, currentCount: 4, previousCents: 0, previousCount: 0, deltaCents: 5000, deltaPercent: null },
    ]);
  });

  it("não calcula percentual sobre zero", () => {
    expect(percentChange(100, 0)).toBeNull();
    expect(percentChange(50, 200)).toBe(-75);
  });
});
