import { describe, expect, it } from "vitest";
import { isAuthorizedCronRequest } from "./cron";

describe("autorização do agendamento", () => {
  it("aceita o segredo correto", () => {
    expect(isAuthorizedCronRequest("Bearer segredo-do-cron", "segredo-do-cron")).toBe(true);
  });

  it.each([
    ["sem cabeçalho", null, "segredo-do-cron"],
    ["segredo errado", "Bearer outro-segredo", "segredo-do-cron"],
    ["sem o prefixo Bearer", "segredo-do-cron", "segredo-do-cron"],
    ["segredo não configurado", "Bearer ", ""],
  ])("recusa %s", (_caso, authorization, secret) => {
    expect(isAuthorizedCronRequest(authorization, secret)).toBe(false);
  });
});
