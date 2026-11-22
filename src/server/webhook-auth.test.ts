import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { hasValidSignature, isAuthenticWebhook } from "./webhook-auth";

const BODY = '{"event":"item/updated","itemId":"item-1"}';
const SIGNING = `whsec_${"a1".repeat(32)}`;
const NOW = 1_795_000_000_000;

function sign(body: string, timestamp = NOW / 1000, secret = SIGNING) {
  return `t=${timestamp},v1=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
}

describe("assinatura da Pluggy", () => {
  it("aceita a assinatura do corpo bruto com o horário atual", () => {
    expect(hasValidSignature(sign(BODY), BODY, SIGNING, NOW)).toBe(true);
  });

  it.each([
    ["sem cabeçalho", null, BODY],
    ["corpo alterado", sign(BODY), BODY.replace("item-1", "item-2")],
    ["outro segredo", sign(BODY, NOW / 1000, "whsec_outro"), BODY],
    ["horário com mais de 5 minutos de diferença", sign(BODY, NOW / 1000 - 301), BODY],
    ["formato inválido", "t=abc,v1=xyz", BODY],
    ["sem v1", `t=${NOW / 1000}`, BODY],
  ])("recusa %s", (_caso, header, body) => {
    expect(hasValidSignature(header, body, SIGNING, NOW)).toBe(false);
  });
});

describe("autenticidade da notificação", () => {
  const secrets = { secret: "segredo-do-webhook" };

  it("exige o segredo combinado no cabeçalho", () => {
    expect(isAuthenticWebhook({ secret: "segredo-do-webhook", signature: null }, BODY, secrets, NOW)).toBe(true);
    expect(isAuthenticWebhook({ secret: "errado", signature: null }, BODY, secrets, NOW)).toBe(false);
    expect(isAuthenticWebhook({ secret: null, signature: null }, BODY, secrets, NOW)).toBe(false);
  });

  it("recusa tudo quando o segredo não está configurado", () => {
    expect(isAuthenticWebhook({ secret: "", signature: null }, BODY, {}, NOW)).toBe(false);
  });

  it("exige também a assinatura quando o segredo de assinatura está configurado", () => {
    const withSigning = { ...secrets, signingSecret: SIGNING };
    expect(isAuthenticWebhook({ secret: "segredo-do-webhook", signature: sign(BODY) }, BODY, withSigning, NOW)).toBe(true);
    expect(isAuthenticWebhook({ secret: "segredo-do-webhook", signature: null }, BODY, withSigning, NOW)).toBe(false);
  });
});
