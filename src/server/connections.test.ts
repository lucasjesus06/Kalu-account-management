import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationConnections } from "@/db/schema";
import { createTestDatabase, seedHousehold } from "@/test/database";

const state = vi.hoisted(() => ({ db: undefined as unknown }));

vi.mock("@/db/client", () => ({ getDb: () => state.db, getServiceDb: () => state.db, asService: <T>(work: () => Promise<T>) => work() }));

const { listConnections, registerConnectedItem, startConnectSession } = await import("./connections");
const { forgetAppApiKey } = await import("./pluggy-app");

const CLIENT_ID = "593ce5a5-bd0f-47d1-af52-50d0acb74bee";
const ITEM_ID = "2eaac5ff-57cb-49bd-b51e-cd6f39ba56d3";

type Rota = (url: string, init?: RequestInit) => { status: number; body?: unknown };

function simularPluggy(rota: Rota) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const { status, body = {} } = rota(url, init);
      return new Response(JSON.stringify(body), { status });
    }),
  );
}

let membros: Awaited<ReturnType<typeof seedHousehold>>;

beforeEach(async () => {
  vi.stubEnv("PLUGGY_CLIENT_ID", CLIENT_ID);
  vi.stubEnv("PLUGGY_CLIENT_SECRET", "segredo");
  forgetAppApiKey();
  const db = await createTestDatabase();
  state.db = db;
  membros = await seedHousehold(db);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("conectar banco pelo Kalu", () => {
  const NEW_ITEM = "9f6b1c2e-3d4a-4b5c-8d9e-0a1b2c3d4e5f";
  const db = () => state.db as Awaited<ReturnType<typeof createTestDatabase>>;
  const pedidos: { url: string; body: unknown }[] = [];

  function pluggyConnect(itemId = ITEM_ID, consentExpiresAt?: string): Rota {
    return (url, init) => {
      pedidos.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
      if (url.endsWith("/auth")) {
        return { status: 200, body: { apiKey: "chave" } };
      }
      if (url.endsWith("/connect_token")) {
        return { status: 200, body: { accessToken: "token-de-conexao" } };
      }
      return { status: 200, body: { id: itemId, connector: { name: "Nubank" }, ...(consentExpiresAt ? { consentExpiresAt } : {}) } };
    };
  }

  beforeEach(() => {
    pedidos.length = 0;
  });

  it("abre a sessão de conexão com um token, sem expor o secret", async () => {
    simularPluggy(pluggyConnect());

    const session = await startConnectSession(membros.lucas.id);

    expect(session).toEqual({ ok: true, connectToken: "token-de-conexao", updateItem: null });
    expect(pedidos.find((p) => p.url.endsWith("/connect_token"))?.body).toMatchObject({
      options: { avoidDuplicates: true, clientUserId: membros.lucas.id },
    });
    expect(JSON.stringify(session)).not.toContain("segredo");
  });

  it("avisa quando a conexão com bancos não foi ativada no ambiente", async () => {
    vi.stubEnv("PLUGGY_CLIENT_ID", "");
    expect(await startConnectSession(membros.lucas.id)).toEqual({
      ok: false,
      error: "A conexão com bancos ainda não foi ativada neste ambiente.",
    });
  });

  it("registra o item criado no widget como uma conexão nova", async () => {
    simularPluggy(pluggyConnect(NEW_ITEM, "2027-11-22T10:00:00.000Z"));

    const result = await registerConnectedItem(membros.lucas.id, NEW_ITEM);

    expect(result).toMatchObject({ ok: true, message: "Conexão com Nubank adicionada." });
    const [connection] = await listConnections(membros.lucas.id);
    expect(connection).toMatchObject({
      id: result.ok ? result.connectionId : "",
      externalItemId: NEW_ITEM,
      institutionName: "Nubank",
      status: "active",
      authorizationExpiresAt: new Date("2027-11-22T10:00:00.000Z"),
    });
  });

  it("renova a conexão existente: token vinculado ao item e conexão de volta para ativa", async () => {
    simularPluggy(pluggyConnect(ITEM_ID, "2027-11-22T10:00:00.000Z"));
    await registerConnectedItem(membros.lucas.id, ITEM_ID);
    const [connection] = await listConnections(membros.lucas.id);
    await db().update(integrationConnections).set({ status: "expired" }).where(eq(integrationConnections.id, connection.id));

    const session = await startConnectSession(membros.lucas.id, connection.id);
    const result = await registerConnectedItem(membros.lucas.id, ITEM_ID, connection.id);

    expect(session).toEqual({ ok: true, connectToken: "token-de-conexao", updateItem: ITEM_ID });
    expect(pedidos.find((p) => p.url.endsWith("/connect_token"))?.body).toMatchObject({ itemId: ITEM_ID });
    expect(result).toEqual({ ok: true, message: "Autorização de Nubank renovada.", connectionId: connection.id });
    expect((await listConnections(membros.lucas.id))[0]).toMatchObject({
      status: "active",
      authorizationExpiresAt: new Date("2027-11-22T10:00:00.000Z"),
    });
  });

  it("mantém a mesma conexão quando a renovação devolve outro item", async () => {
    simularPluggy(pluggyConnect(NEW_ITEM));
    simularPluggy(pluggyConnect(ITEM_ID));
    await registerConnectedItem(membros.lucas.id, ITEM_ID);
    const [connection] = await listConnections(membros.lucas.id);
    simularPluggy(pluggyConnect(NEW_ITEM));

    const result = await registerConnectedItem(membros.lucas.id, NEW_ITEM, connection.id);

    expect(result).toMatchObject({ ok: true, connectionId: connection.id });
    const connections = await listConnections(membros.lucas.id);
    expect(connections).toHaveLength(1);
    expect(connections[0].externalItemId).toBe(NEW_ITEM);
  });

  it("reativa em vez de duplicar quando o mesmo banco é conectado de novo", async () => {
    simularPluggy(pluggyConnect());
    await registerConnectedItem(membros.lucas.id, ITEM_ID);

    const result = await registerConnectedItem(membros.lucas.id, ITEM_ID);

    expect(result.ok).toBe(true);
    expect(await listConnections(membros.lucas.id)).toHaveLength(1);
  });

  it("não deixa conectar o banco que já é de outro integrante", async () => {
    simularPluggy(pluggyConnect());
    await registerConnectedItem(membros.lucas.id, ITEM_ID);

    expect(await registerConnectedItem(membros.karina.id, ITEM_ID)).toEqual({
      ok: false,
      error: "Esse banco já foi conectado por outro integrante da residência.",
    });
  });

  it("não renova conexão de outro integrante", async () => {
    simularPluggy(pluggyConnect());
    await registerConnectedItem(membros.lucas.id, ITEM_ID);
    const [connection] = await listConnections(membros.lucas.id);

    expect(await startConnectSession(membros.karina.id, connection.id)).toEqual({ ok: false, error: "Conexão não encontrada." });
    expect(await registerConnectedItem(membros.karina.id, ITEM_ID, connection.id)).toEqual({
      ok: false,
      error: "Conexão não encontrada.",
    });
  });

  it("recusa identificador inválido vindo do widget", async () => {
    expect(await registerConnectedItem(membros.lucas.id, "nao-e-uuid")).toMatchObject({ ok: false });
  });
});
