import { describe, expect, it } from "vitest";
import accountsFixture from "./__fixtures__/accounts.json";
import bankTransactionsFixture from "./__fixtures__/bank-transactions.json";
import billsFixture from "./__fixtures__/bills.json";
import cardTransactionsFixture from "./__fixtures__/card-transactions.json";
import { mapAccount, mapBill, mapTransaction } from "./mappers";
import type { PluggyAccount, PluggyBill, PluggyTransaction } from "./types";

const [rawChecking, rawCard] = accountsFixture.results as PluggyAccount[];
const checking = mapAccount(rawChecking);
const card = mapAccount(rawCard);
const cardTransactions = (cardTransactionsFixture.results as PluggyTransaction[]).map((t) => mapTransaction(t, card));
const bankTransactions = (bankTransactionsFixture.results as PluggyTransaction[]).map((t) => mapTransaction(t, checking));
const byId = (id: string) => [...cardTransactions, ...bankTransactions].find((t) => t.externalId === id)!;

describe("mapAccount", () => {
  it("mapeia a conta corrente sem dados de crédito e guarda só os 4 últimos dígitos", () => {
    expect(checking).toEqual({
      externalId: "48f9caac-0ea6-477c-8962-5a3183c9ee29",
      kind: "checking",
      name: "Banco Santander Pessoa Física",
      numberLast4: "9991",
      currency: "BRL",
      balanceCents: 0,
      credit: null,
    });
  });

  it("mapeia o cartão tratando o saldo como limite utilizado, não como fatura", () => {
    expect(card).toEqual({
      externalId: "f9dd22a9-84dd-470d-8d0e-63a02537d5bc",
      kind: "credit_card",
      name: "ELITE CASHBACK VISA SIGNATURE",
      numberLast4: "1234",
      currency: "BRL",
      balanceCents: 799275,
      credit: {
        limitCents: 800000,
        availableCents: 725,
        usedCents: 799275,
        brand: "VISA",
        lastBillDueDate: "2026-11-03",
      },
    });
  });

  it("não expõe CPF, titular nem número completo", () => {
    const serialized = JSON.stringify([checking, card]);
    expect(serialized).not.toContain("000.000.000-00");
    expect(serialized).not.toContain("TITULAR");
    expect(serialized).not.toContain("00009999999");
  });

  it("classifica poupança e tipos desconhecidos", () => {
    expect(mapAccount({ id: "p", type: "BANK", subtype: "SAVINGS_ACCOUNT", name: "Poupança", balance: 10 }).kind).toBe("savings");
    expect(mapAccount({ id: "o", type: "INVESTMENT", name: "CDB", balance: 10 }).kind).toBe("other");
  });
});

describe("mapBill", () => {
  it("mapeia a fatura com vencimento como data e valores em centavos", () => {
    const [november] = (billsFixture.results as PluggyBill[]).map((bill) => mapBill(bill, card.externalId));
    expect(november).toEqual({
      externalId: "0c15574b-9488-4556-a388-d3891cd01bfd",
      accountExternalId: card.externalId,
      dueDate: "2026-11-03",
      totalCents: 403477,
      minimumPaymentCents: 54336,
      currency: "BRL",
    });
  });
});

describe("mapTransaction", () => {
  it("compra no cartão sai como despesa vinculada à fatura", () => {
    expect(byId("aa11aa11-0000-4000-8000-000000000004")).toMatchObject({
      amountCents: 2809,
      direction: "outflow",
      status: "posted",
      billExternalId: "0c15574b-9488-4556-a388-d3891cd01bfd",
      installment: null,
      description: "DL          *UberRides",
    });
  });

  it("pagamento de fatura no cartão entra como crédito com valor positivo", () => {
    expect(byId("aa11aa11-0000-4000-8000-000000000003")).toMatchObject({
      amountCents: 636517,
      direction: "inflow",
      billExternalId: "0c15574b-9488-4556-a388-d3891cd01bfd",
    });
  });

  it("transação da fatura aberta vem sem fatura e pode estar pendente", () => {
    expect(byId("aa11aa11-0000-4000-8000-000000000001")).toMatchObject({
      status: "pending",
      billExternalId: null,
      direction: "outflow",
    });
  });

  it("mantém parcela e total de parcelas", () => {
    expect(byId("6af5f200-2ac8-4a62-909d-18faadb7dd62")).toMatchObject({
      amountCents: 122067,
      installment: { number: 2, total: 2 },
      occurredAt: "2026-09-28T03:00:00.000Z",
    });
    expect(byId("c621701a-e6b6-4f32-a698-69c2d82f0196").installment).toEqual({ number: 1, total: 3 });
  });

  it("estorno pequeno no cartão entra como crédito", () => {
    expect(byId("aa11aa11-0000-4000-8000-000000000005")).toMatchObject({ amountCents: 729, direction: "inflow" });
  });

  it("compra em moeda estrangeira usa o valor convertido na moeda da conta", () => {
    expect(byId("aa11aa11-0000-4000-8000-000000000006")).toMatchObject({ amountCents: 5412, currency: "BRL" });
  });

  it("na conta corrente, débito é saída e crédito é entrada", () => {
    expect(byId("bb22bb22-0000-4000-8000-000000000001")).toMatchObject({ amountCents: 360000, direction: "inflow" });
    expect(byId("bb22bb22-0000-4000-8000-000000000002")).toMatchObject({ amountCents: 403477, direction: "outflow" });
  });

  it("sem tipo informado, usa o sinal conforme a convenção de cada tipo de conta", () => {
    const semTipo = (amount: number) => ({ id: "x", date: "2026-11-01T00:00:00.000Z", description: "x", amount });
    expect(mapTransaction(semTipo(10), card).direction).toBe("outflow");
    expect(mapTransaction(semTipo(-10), card).direction).toBe("inflow");
    expect(mapTransaction(semTipo(-10), checking).direction).toBe("outflow");
    expect(mapTransaction(semTipo(10), checking).direction).toBe("inflow");
  });
});
