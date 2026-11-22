import { describe, expect, it } from "vitest";
import { displayNameFromEmail } from "./household";

describe("displayNameFromEmail", () => {
  it.each([
    ["lucas@teste.dev", "Lucas"],
    ["maria.silva@exemplo.com", "Maria Silva"],
    ["joao_pedro-santos@x.com", "Joao Pedro Santos"],
    ["", "Eu"],
    [null, "Eu"],
    [undefined, "Eu"],
    ["@x.com", "Eu"],
  ])("%s vira %s", (email, expected) => {
    expect(displayNameFromEmail(email)).toBe(expected);
  });

  it("limita o tamanho", () => {
    expect(displayNameFromEmail(`${"a".repeat(100)}@x.com`)).toHaveLength(60);
  });
});
