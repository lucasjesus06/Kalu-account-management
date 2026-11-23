import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { registerWebhook, webhookUrl } = await import("./webhook-registration");
const { forgetAppApiKey } = await import("./pluggy-app");

const CLIENT_ID = "593ce5a5-bd0f-47d1-af52-50d0acb74bee";
const requests: { url: string; method: string; body: unknown }[] = [];

function pluggy(webhookStatus = 201) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      requests.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : null });
      if (url.endsWith("/auth")) {
        return new Response(JSON.stringify({ apiKey: "chave" }), { status: 200 });
      }
      if (method === "GET") {
        return new Response(JSON.stringify({ results: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ id: "webhook-1" }), { status: webhookStatus });
    }),
  );
}

beforeEach(() => {
  requests.length = 0;
  forgetAppApiKey();
  vi.stubEnv("PLUGGY_CLIENT_ID", CLIENT_ID);
  vi.stubEnv("PLUGGY_CLIENT_SECRET", "segredo");
  vi.stubEnv("PLUGGY_WEBHOOK_SECRET", "segredo-do-webhook");
  vi.stubEnv("APP_URL", "https://kalu.example.com");
  pluggy();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("endereço do webhook", () => {
  it.each([
    [{ APP_URL: "https://kalu.example.com" }, "https://kalu.example.com/api/webhooks/pluggy"],
    [{ APP_URL: "https://kalu.example.com/" }, "https://kalu.example.com/api/webhooks/pluggy"],
    [{ VERCEL_PROJECT_PRODUCTION_URL: "kalu.vercel.app" }, "https://kalu.vercel.app/api/webhooks/pluggy"],
    [{ APP_URL: "http://localhost:3000" }, null],
    [{}, null],
  ])("%o → %s", (env, expected) => {
    expect(webhookUrl(env)).toBe(expected);
  });
});

describe("ativar notificações", () => {
  it("cadastra o webhook com o segredo", async () => {
    expect(await registerWebhook()).toEqual({ ok: true, message: "Notificações da Pluggy ativadas." });

    const created = requests.find((request) => request.method === "POST" && request.url.endsWith("/webhooks"));
    expect(created?.body).toEqual({
      event: "all",
      url: "https://kalu.example.com/api/webhooks/pluggy",
      headers: { "x-kalu-webhook-secret": "segredo-do-webhook" },
    });
  });

  it.each([
    ["sem segredo configurado", { PLUGGY_WEBHOOK_SECRET: "" }, "PLUGGY_WEBHOOK_SECRET"],
    ["sem endereço publicado", { APP_URL: "http://localhost:3000" }, "HTTPS"],
  ])("não ativa %s", async (_caso, env, trecho) => {
    for (const [key, value] of Object.entries(env)) {
      vi.stubEnv(key, value);
    }

    const result = await registerWebhook();

    expect(result).toMatchObject({ ok: false, error: expect.stringContaining(trecho) });
    expect(requests.some((request) => request.url.includes("/webhooks"))).toBe(false);
  });

  it("explica quando a Pluggy recusa o endereço", async () => {
    pluggy(400);

    expect(await registerWebhook()).toMatchObject({ ok: false, error: expect.stringContaining("recusou o endereço") });
  });

  it("avisa quando a conexão com bancos não foi ativada no ambiente", async () => {
    vi.stubEnv("PLUGGY_CLIENT_SECRET", "");

    expect(await registerWebhook()).toMatchObject({ ok: false, error: expect.stringContaining("não foi ativada") });
  });
});
