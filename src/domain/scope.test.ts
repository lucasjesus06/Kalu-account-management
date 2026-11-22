import { describe, expect, it } from "vitest";
import { householdScope, personalScope, resolveScope, scopeChoice } from "./scope";

const ME = "m-1";

describe("resolveScope", () => {
  it("sem residência, o escopo é pessoal", () => {
    expect(resolveScope(undefined, ME, [])).toEqual(personalScope(ME));
    expect(resolveScope("qualquer", ME, [])).toEqual(personalScope(ME));
  });

  it("sem escolha, usa a primeira residência", () => {
    expect(resolveScope(undefined, ME, ["h-1", "h-2"])).toEqual(householdScope("h-1"));
  });

  it("respeita a escolha de uma residência da própria pessoa", () => {
    expect(resolveScope("h-2", ME, ["h-1", "h-2"])).toEqual(householdScope("h-2"));
  });

  it("respeita a escolha pessoal mesmo com residência", () => {
    expect(resolveScope("pessoal", ME, ["h-1"])).toEqual(personalScope(ME));
  });

  it("ignora a escolha de uma residência da qual a pessoa não participa", () => {
    expect(resolveScope("h-de-outra-pessoa", ME, ["h-1"])).toEqual(householdScope("h-1"));
  });

  it("scopeChoice é o inverso", () => {
    expect(scopeChoice(personalScope(ME))).toBe("pessoal");
    expect(scopeChoice(householdScope("h-1"))).toBe("h-1");
  });
});
