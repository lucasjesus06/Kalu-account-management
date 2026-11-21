import { describe, expect, it } from "vitest";
import {
  classifyCardTransaction,
  composeClosedBills,
  composeOpenBill,
  type CardBill,
  type CardTransaction,
} from "./bills";

const OUTUBRO = "fatura-outubro";
const NOVEMBRO = "fatura-novembro";

const bills: CardBill[] = [
  { externalId: OUTUBRO, dueDate: "2026-10-03", totalCents: 636517 },
  { externalId: NOVEMBRO, dueDate: "2026-11-03", totalCents: 403477 },
];

function purchase(amountCents: number, billExternalId: string | null, overrides: Partial<CardTransaction> = {}): CardTransaction {
  return {
    amountCents,
    direction: "outflow",
    status: "posted",
    description: "COMPRA",
    providerCategory: "Shopping",
    billExternalId,
    ...overrides,
  };
}

function credit(amountCents: number, billExternalId: string | null, overrides: Partial<CardTransaction> = {}): CardTransaction {
  return purchase(amountCents, billExternalId, { direction: "inflow", description: "ESTORNO", providerCategory: null, ...overrides });
}

describe("classificação das transações do cartão", () => {
  it("toda saída é compra", () => {
    expect(classifyCardTransaction(purchase(5000, null), [])).toBe("purchase");
  });

  it.each([
    ["pela categoria da fonte", { description: "QUALQUER", providerCategory: "Credit card payment" }],
    ["pela descrição", { description: "PAGAMENTO DE FATURA" }],
    ["pela descrição abreviada", { description: "PGTO FATURA CARTAO" }],
    ["pela descrição com acento", { description: "Pagamento recebido" }],
  ])("reconhece pagamento de fatura %s", (_motivo, overrides) => {
    expect(classifyCardTransaction(credit(100, null, overrides), [])).toBe("bill_payment");
  });

  it("reconhece pagamento pelo valor de uma fatura, com tolerância de centavos", () => {
    expect(classifyCardTransaction(credit(604321, null, { description: "CREDITO" }), [604326])).toBe("bill_payment");
    expect(classifyCardTransaction(credit(604300, null, { description: "CREDITO" }), [604326])).toBe("credit");
  });

  it("estorno e cashback são créditos, não pagamento", () => {
    expect(classifyCardTransaction(credit(729, null, { description: "IFD*COMPANHIA" }), [403477])).toBe("credit");
    expect(classifyCardTransaction(credit(150, null, { description: "CASHBACK" }), [403477])).toBe("credit");
  });
});

describe("fatura fechada", () => {
  const transactions = [
    purchase(122067, NOVEMBRO),
    purchase(2809, NOVEMBRO),
    credit(636517, NOVEMBRO, { description: "PAGAMENTO DE FATURA" }),
    credit(1000, NOVEMBRO),
    purchase(999, OUTUBRO),
    purchase(5000, "fatura-de-outro-ciclo"),
  ];

  it("monta pelo identificador da fatura, com a mais recente primeiro", () => {
    const [novembro, outubro] = composeClosedBills(transactions, bills);

    expect(novembro).toMatchObject({ externalId: NOVEMBRO, purchasesCents: 124876, purchasesCount: 2 });
    expect(outubro).toMatchObject({ externalId: OUTUBRO, purchasesCents: 999, purchasesCount: 1 });
  });

  it("não abate o pagamento da fatura anterior das compras", () => {
    const [novembro] = composeClosedBills(transactions, bills);

    expect(novembro).toMatchObject({ billPaymentsCents: 636517, creditsCents: 1000, netCents: 123876 });
  });

  it("mostra a diferença para o valor oficial como não identificada pela fonte", () => {
    const [novembro] = composeClosedBills(transactions, bills);

    expect(novembro).toMatchObject({ officialTotalCents: 403477, unidentifiedCents: 403477 - 123876 });
  });

  it("marca a fatura mais antiga como incompleta", () => {
    const [novembro, outubro] = composeClosedBills(transactions, bills);

    expect(novembro.incomplete).toBe(false);
    expect(outubro.incomplete).toBe(true);
  });

  it("aceita fatura sem nenhuma transação importada", () => {
    const [novembro] = composeClosedBills([], bills);

    expect(novembro).toMatchObject({ purchasesCents: 0, netCents: 0, unidentifiedCents: 403477 });
  });
});

describe("fatura aberta", () => {
  it("considera só as transações sem fatura e não soma o pagamento da fatura anterior", () => {
    const open = composeOpenBill(
      [
        purchase(6082, null),
        purchase(600, null, { status: "pending" }),
        credit(403477, null, { description: "PAGAMENTO DE FATURA" }),
        credit(500, null),
        purchase(122067, NOVEMBRO),
      ],
      bills,
    );

    expect(open).toEqual({
      purchasesCents: 6682,
      creditsCents: 500,
      billPaymentsCents: 403477,
      netCents: 6182,
      pendingCents: 600,
      purchasesCount: 2,
      creditsCount: 1,
    });
  });
});
