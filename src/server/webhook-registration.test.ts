import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationConnections, webhookEvents } from "@/db/schema";
import { createTestDatabase, seedHousehold } from "@/test/database";

const state = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("@/db/client", () => ({ getDb: () => state.db, getServiceDb: () => state.db, asService: <T>(work: () => Promise<T>) => work() }));

const { getCredentialsSummary, saveCredentials } = await import("./connections");
const { registerWebhook, webhookUrl } = await import("./webhook-registration");

type TestDb = Awaited<ReturnType<typeof createTestDatabase>>;
const db = () => state.db as TestDb;
const CLIENT_ID = "593ce5a5-bd0f-47d1-af52-50d0acb74bee";
const OTHER_CLIENT_ID = "11111111-2222-3333-4444-555555555555";
let memberId: string;
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

beforeEach(async () => {
  requests.length = 0;
  vi.stubEnv("ENCRYPTION_KEY", randomBytes(32).toString("base64"));
  vi.stubEnv("PLUGGY_WEBHOOK_SECRET", "segredo-do-webhook");
  vi.stubEnv("APP_URL", "https://kalu.example.com");
  state.db = await createTestDatabase();
  const { lucas } = await seedHousehold(db());
  memberId = lucas.id;
  pluggy();
  await saveCredentials(memberId, CLIENT_ID, "segredo");
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
  it("cadastra o webhook com o segredo e marca como ativo", async () => {
    expect(await registerWebhook(memberId)).toEqual({ ok: true, message: "Notificações da Pluggy ativadas." });

    const created = requests.find((request) => request.method === "POST" && request.url.endsWith("/webhooks"));
    expect(created?.body).toEqual({
      event: "all",
      url: "https://kalu.example.com/api/webhooks/pluggy",
      headers: { "x-kalu-webhook-secret": "segredo-do-webhook" },
    });
    expect((await getCredentialsSummary(memberId))?.webhookRegisteredAt).toBeInstanceOf(Date);
  });

  it.each([
    ["sem segredo configurado", { PLUGGY_WEBHOOK_SECRET: "" }, "PLUGGY_WEBHOOK_SECRET"],
    ["sem endereço publicado", { APP_URL: "http://localhost:3000" }, "HTTPS"],
  ])("não ativa %s", async (_caso, env, trecho) => {
    for (const [key, value] of Object.entries(env)) {
      vi.stubEnv(key, value);
    }

    const result = await registerWebhook(memberId);

    expect(result).toMatchObject({ ok: false, error: expect.stringContaining(trecho) });
    expect(requests.some((request) => request.url.includes("/webhooks"))).toBe(false);
  });

  it("explica quando a Pluggy recusa o endereço", async () => {
    pluggy(400);

    expect(await registerWebhook(memberId)).toMatchObject({ ok: false, error: expect.stringContaining("recusou o endereço") });
    expect((await getCredentialsSummary(memberId))?.webhookRegisteredAt).toBeNull();
  });

  it("mantém o webhook ao trocar só o secret e o desfaz ao trocar de aplicação", async () => {
    await registerWebhook(memberId);

    await saveCredentials(memberId, CLIENT_ID, "segredo-novo");
    expect((await getCredentialsSummary(memberId))?.webhookRegisteredAt).toBeInstanceOf(Date);

    await saveCredentials(memberId, OTHER_CLIENT_ID, "segredo");
    expect((await getCredentialsSummary(memberId))?.webhookRegisteredAt).toBeNull();
  });

  it("informa a última notificação recebida das conexões do integrante", async () => {
    const [connection] = await db()
      .insert(integrationConnections)
      .values({ memberId, externalItemId: "item", institutionName: "Santander" })
      .returning();
    await db().insert(webhookEvents).values([
      { externalEventId: "e1", event: "item/updated", connectionId: connection.id, receivedAt: new Date("2026-11-20T10:00:00Z") },
      { externalEventId: "e2", event: "item/updated", connectionId: connection.id, receivedAt: new Date("2026-11-22T10:00:00Z") },
    ]);

    expect((await getCredentialsSummary(memberId))?.lastWebhookAt).toEqual(new Date("2026-11-22T10:00:00Z"));
  });
});
