import { describe, expect, it } from "vitest";
import {
  expenseChoiceOf,
  expenseNatureKey,
  expenseNatureLabel,
  parseExpenseChoice,
  resolveExpenseNature,
  UNDEFINED_NATURE_KEY,
  type ExpenseAssignment,
} from "./expense-nature";

const mercado = { slug: "supermercado", kind: "expense" as const };
const restaurantes = { slug: "restaurantes", kind: "expense" as const };
const transferencia = { slug: "transferencia-entre-integrantes", kind: "transfer" as const };
const rules = new Map<string, ExpenseAssignment>([
  ["IFOOD", { nature: "shared", memberId: null }],
  ["SMART FIT", { nature: "individual", memberId: "lucas" }],
  ["CARREFOUR", { nature: "individual", memberId: "karina" }],
]);

describe("para quem automático", () => {
  it("marca como Casa as categorias da residência", () => {
    expect(resolveExpenseNature({ merchantName: "SONDA", category: mercado }, rules)).toEqual({
      assignment: { nature: "household", memberId: null },
      source: "automatic",
    });
  });

  it("não inventa para quem nas demais categorias nem sem categoria", () => {
    expect(resolveExpenseNature({ merchantName: "OUTBACK", category: restaurantes }, rules)).toBeNull();
    expect(resolveExpenseNature({ merchantName: "LOJA", category: null }, rules)).toBeNull();
  });

  it("regra do estabelecimento vale mais que a categoria", () => {
    expect(resolveExpenseNature({ merchantName: "IFOOD", category: restaurantes }, rules)).toEqual({
      assignment: { nature: "shared", memberId: null },
      source: "rule",
    });
    expect(resolveExpenseNature({ merchantName: "CARREFOUR", category: mercado }, rules)).toEqual({
      assignment: { nature: "individual", memberId: "karina" },
      source: "rule",
    });
  });

  it("transferências não têm para quem", () => {
    expect(resolveExpenseNature({ merchantName: "IFOOD", category: transferencia }, rules)).toBeNull();
  });
});

describe("escolha no formulário", () => {
  const members = ["lucas", "karina"];

  it.each([
    ["", null],
    ["household", { nature: "household", memberId: null }],
    ["shared", { nature: "shared", memberId: null }],
    ["karina", { nature: "individual", memberId: "karina" }],
    ["outra-pessoa", undefined],
  ])("%s", (value, expected) => {
    expect(parseExpenseChoice(value, members)).toEqual(expected);
  });

  it("volta para o valor do formulário", () => {
    expect(expenseChoiceOf({ nature: null, memberId: null })).toBe("");
    expect(expenseChoiceOf({ nature: "household", memberId: null })).toBe("household");
    expect(expenseChoiceOf({ nature: "individual", memberId: "lucas" })).toBe("lucas");
  });
});

describe("rótulos e chaves", () => {
  it.each([
    [{ nature: "household" as const, memberId: null, memberName: null }, "household", "Casa"],
    [{ nature: "shared" as const, memberId: null, memberName: null }, "shared", "Compartilhado"],
    [{ nature: "individual" as const, memberId: "lucas", memberName: "Lucas" }, "integrante-lucas", "Lucas"],
    [{ nature: null, memberId: null, memberName: null }, UNDEFINED_NATURE_KEY, "Sem definição"],
  ])("%o", (assignment, key, label) => {
    expect(expenseNatureKey(assignment)).toBe(key);
    expect(expenseNatureLabel(assignment)).toBe(label);
  });
});
