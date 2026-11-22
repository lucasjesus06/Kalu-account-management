import { describe, expect, it } from "vitest";
import { parseDisplayName, validatePasswordChange } from "./account";

describe("conta", () => {
  it("normaliza e valida o nome", () => {
    expect(parseDisplayName("  Lucas   de Jesus ")).toBe("Lucas de Jesus");
    expect(parseDisplayName("  ")).toBeNull();
    expect(parseDisplayName("x".repeat(61))).toBeNull();
    expect(parseDisplayName(null)).toBeNull();
  });

  it("valida a troca de senha", () => {
    expect(validatePasswordChange("", "novasenha1", "novasenha1")).toMatch(/senha atual/);
    expect(validatePasswordChange("antiga123", "curta", "curta")).toMatch(/pelo menos 8/);
    expect(validatePasswordChange("antiga123", "novasenha1", "outra")).toMatch(/confirmação/);
    expect(validatePasswordChange("antiga123", "antiga123", "antiga123")).toMatch(/diferente/);
    expect(validatePasswordChange("antiga123", "novasenha1", "novasenha1")).toBeNull();
  });
});
