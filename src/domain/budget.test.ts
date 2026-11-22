import { describe, expect, it } from "vitest";
import {
  goalLabel,
  goalMatches,
  goalProgress,
  isActiveIn,
  parseMoneyInput,
  parseThresholds,
  sameTarget,
} from "./budget";
import type { ConsumptionRecord } from "./consumption";
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
    category: restaurantes,
    categorySource: "automatic",
    expenseNature: null,
    expenseMemberId: null,
    expenseMemberName: null,
    expenseNatureSource: null,
    installmentNumber: null,
    installmentTotal: null,
    accountId: "cartao",
    accountKind: "credit_card",
    accountName: "Cartão",
    institutionName: "Santander",
    memberName: "Lucas",
    billDueDate: null,
    ...overrides,
  };
}

const goal = {
  categorySlug: "restaurantes",
  nature: null,
  memberId: null,
  limitCents: 50000,
  thresholds: [70, 90, 100],
};
const november = fullMonth("2026-11");

describe("valor da meta", () => {
  it.each([
    ["500", 50000],
    ["500,5", 50050],
    ["R$ 1.200,50", 120050],
    ["1.200", 120000],
    ["1200.75", 120075],
    ["0,99", 99],
  ])("%s", (text, cents) => {
    expect(parseMoneyInput(text)).toBe(cents);
  });

  it.each(["", "0", "-10", "abc", "1,2,3", "12,345"])("recusa %s", (text) => {
    expect(parseMoneyInput(text)).toBeNull();
  });
});

describe("percentuais de aviso", () => {
  it("aceita separadores variados, ordena e remove repetidos", () => {
    expect(parseThresholds("100, 70; 90 90%")).toEqual([70, 90, 100]);
  });

  it.each(["", "0", "301", "50, abc", "10, 20, 30, 40, 50, 60"])("recusa %s", (text) => {
    expect(parseThresholds(text)).toBeNull();
  });
});

describe("vigência", () => {
  it("vale do mês de início até o mês de encerramento", () => {
    const goalMonths = { startsMonth: "2026-09", endsMonth: "2026-10" };
    expect(["2026-08", "2026-09", "2026-10", "2026-11"].map((month) => isActiveIn(goalMonths, month))).toEqual([
      false,
      true,
      true,
      false,
    ]);
    expect(isActiveIn({ startsMonth: "2026-09", endsMonth: null }, "2027-01")).toBe(true);
  });
});

describe("o que entra na meta", () => {
  it("filtra pela categoria e, quando escolhido, por para quem", () => {
    const shared = { ...goal, nature: "shared" as const };
    expect(goalMatches(goal, record(100))).toBe(true);
    expect(goalMatches(goal, record(100, { category: mercado }))).toBe(false);
    expect(goalMatches(shared, record(100))).toBe(false);
    expect(goalMatches(shared, record(100, { expenseNature: "shared" }))).toBe(true);
    expect(goalMatches({ ...goal, categorySlug: null }, record(100, { category: null }))).toBe(true);
    expect(
      goalMatches(
        { ...goal, nature: "individual", memberId: "karina" },
        record(100, { expenseNature: "individual", expenseMemberId: "lucas" }),
      ),
    ).toBe(false);
  });

  it("identifica a mesma meta pela categoria e para quem", () => {
    expect(sameTarget(goal, { ...goal })).toBe(true);
    expect(sameTarget(goal, { ...goal, nature: "household" })).toBe(false);
  });

  it("descreve a meta", () => {
    expect(goalLabel({ categoryName: "Restaurantes e delivery", nature: null, memberId: null, memberName: null })).toBe(
      "Restaurantes e delivery",
    );
    expect(goalLabel({ categoryName: null, nature: "individual", memberId: "k", memberName: "Karina" })).toBe(
      "Todo o consumo · Karina",
    );
  });
});

describe("progresso da meta", () => {
  it("soma compras menos estornos do mês, sem transferências, outras categorias e outros meses", () => {
    const progress = goalProgress(
      goal,
      [
        record(30000),
        record(8000),
        record(3000, { direction: "inflow", description: "ESTORNO" }),
        record(20000, { category: transferencia }),
        record(9000, { category: mercado }),
        record(7000, { occurredAt: new Date("2026-10-31T23:00:00-03:00") }),
      ],
      [],
      november,
    );

    expect(progress).toEqual({
      consumedCents: 35000,
      purchasesCount: 2,
      percent: 70,
      remainingCents: 15000,
      reached: [70],
      status: "warning",
    });
  });

  it("fica normal antes do primeiro aviso e estoura ao chegar no limite", () => {
    expect(goalProgress(goal, [record(10000)], [], november)).toMatchObject({ status: "ok", reached: [] });
    expect(goalProgress(goal, [record(50000)], [], november)).toMatchObject({
      status: "over",
      reached: [70, 90, 100],
      remainingCents: 0,
    });
    expect(goalProgress({ ...goal, thresholds: [50, 120] }, [record(61000)], [], november)).toMatchObject({
      status: "over",
      reached: [50, 120],
      remainingCents: -11000,
    });
  });
});
