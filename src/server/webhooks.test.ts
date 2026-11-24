import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { integrationConnections, pluggyCredentials, webhookEvents } from "@/db/schema";
import { createTestDatabase, seedHousehold } from "@/test/database";

const state = vi.hoisted(() => ({ db: undefined as unknown, sync: vi.fn() }));
vi.mock("@/db/client", () => ({ getDb: () => state.db, getServiceDb: () => state.db, asService: <T>(work: () => Promise<T>) => work() }));
vi.mock("./sync", () => ({
  SYNC_ALREADY_RUNNING: "Já existe uma sincronização em andamento para esta conexão.",
  syncConnection: state.sync,
}));

const { parseWebhookPayload, processWebhookEvent, recordWebhookEvent } = await import("./webhooks");

type TestDb = Awaited<ReturnType<typeof createTestDatabase>>;
const db = () => state.db as TestDb;

const CLIENT_ID = "593ce5a5-bd0f-47d1-af52-50d0acb74bee";
const ITEM_ID = "2eaac5ff-57cb-49bd-b51e-cd6f39ba56d3";
let connectionId: string;
let sequence = 0;

function payload(event: string, overrides: Record<string, unknown> = {}) {
  sequence += 1;
  return parseWebhookPayload(
    JSON.stringify({ event, eventId: `evento-${sequence}`, clientId: CLIENT_ID, itemId: ITEM_ID, triggeredBy: "SYNC", ...overrides }),
  )!;
}

async function receive(event: ReturnType<typeof payload>) {
  const id = await recordWebhookEvent(event);
  return { id, outcome: id ? await processWebhookEvent(id, event) : null };
}

beforeEach(async () => {
  state.db = await createTestDatabase();
  state.sync.mockReset().mockResolvedValue({ ok: true });
  const { lucas } = await seedHousehold(db());
  vi.stubEnv("PLUGGY_CLIENT_ID", CLIENT_ID);
  const [connection] = await db()
    .insert(integrationConnections)
    .values({ memberId: lucas.id, externalItemId: ITEM_ID, institutionName: "Santander" })
    .returning();
  connectionId = connection.id;
});

describe("leitura da notificação", () => {
  it("lê os campos usados e ignora o resto", () => {
    expect(parseWebhookPayload('{"event":"item/updated","eventId":"e1","itemId":"i1","extra":1}')).toEqual({
      event: "item/updated",
      eventId: "e1",
      clientId: null,
      itemId: "i1",
      triggeredBy: null,
    });
  });

  it.each(["não é json", "null", "[]", '{"event":"item/updated"}', '{"eventId":"e1"}'])("recusa %s", (raw) => {
    expect(parseWebhookPayload(raw)).toBeNull();
  });
});

describe("processamento dos eventos", () => {
  it.each(["item/updated", "item/created", "item/error", "transactions/created", "transactions/updated", "transactions/deleted"])(
    "%s sincroniza a conexão do item",
    async (event) => {
      const { outcome } = await receive(payload(event));

      expect(state.sync).toHaveBeenCalledWith(connectionId);
      expect(outcome).toEqual({ result: "synced", detail: null, connectionId });
    },
  );

  it("item/deleted marca a conexão como revogada sem sincronizar", async () => {
    const { outcome } = await receive(payload("item/deleted"));

    expect(outcome?.result).toBe("revoked");
    expect(state.sync).not.toHaveBeenCalled();
    const [connection] = await db().select().from(integrationConnections);
    expect(connection.status).toBe("revoked");
  });

  it("ignora eventos sem ação, itens desconhecidos e outro Client ID", async () => {
    expect((await receive(payload("item/waiting_user_input"))).outcome).toMatchObject({ result: "ignored", detail: "Evento sem ação no Kalu." });
    expect((await receive(payload("item/updated", { itemId: "outro-item" }))).outcome).toMatchObject({
      result: "ignored",
      detail: "Item sem conexão no Kalu.",
    });
    expect((await receive(payload("item/updated", { clientId: "outra-aplicacao" }))).outcome).toMatchObject({
      result: "ignored",
      detail: "Client ID diferente do cadastrado.",
    });
    expect((await receive(payload("connector/status_updated", { itemId: undefined }))).outcome).toMatchObject({ result: "ignored" });
    expect(state.sync).not.toHaveBeenCalled();
  });

  it("confere o Client ID da credencial própria de quem conectou o banco", async () => {
    const OWN_CLIENT_ID = "11111111-2222-4333-8444-555555555555";
    const [{ memberId }] = await db().select({ memberId: integrationConnections.memberId }).from(integrationConnections);
    await db().insert(pluggyCredentials).values({ memberId, clientId: OWN_CLIENT_ID, clientSecretEncrypted: "v1:a:b:c" });

    expect((await receive(payload("item/updated"))).outcome).toMatchObject({ result: "ignored", detail: "Client ID diferente do cadastrado." });
    expect((await receive(payload("item/updated", { clientId: OWN_CLIENT_ID }))).outcome).toMatchObject({ result: "synced" });
  });

  it("não processa duas vezes a mesma entrega", async () => {
    const event = payload("item/updated");

    const first = await receive(event);
    const second = await receive(event);

    expect(first.id).not.toBeNull();
    expect(second.id).toBeNull();
    expect(state.sync).toHaveBeenCalledTimes(1);
  });

  it("registra a falha da sincronização e trata a trava como evento já atendido", async () => {
    state.sync.mockResolvedValueOnce({ ok: false, error: "A Pluggy não respondeu." });
    state.sync.mockResolvedValueOnce({ ok: false, error: "Já existe uma sincronização em andamento para esta conexão." });

    expect((await receive(payload("item/updated"))).outcome).toMatchObject({ result: "failed", detail: "A Pluggy não respondeu." });
    expect((await receive(payload("transactions/created"))).outcome).toMatchObject({ result: "ignored" });
  });

  it("guarda o histórico de cada notificação", async () => {
    const event = payload("item/updated", { triggeredBy: "USER" });
    await receive(event);

    const [stored] = await db().select().from(webhookEvents).where(eq(webhookEvents.externalEventId, event.eventId));
    expect(stored).toMatchObject({
      provider: "pluggy",
      event: "item/updated",
      externalItemId: ITEM_ID,
      connectionId,
      triggeredBy: "USER",
      result: "synced",
    });
    expect(stored.processedAt).toBeInstanceOf(Date);
  });

  it("registra falha inesperada sem derrubar o processamento", async () => {
    state.sync.mockRejectedValueOnce(new Error("conexão caiu"));

    expect((await receive(payload("item/updated"))).outcome).toMatchObject({ result: "failed", detail: "Falha inesperada ao processar." });
  });
});
