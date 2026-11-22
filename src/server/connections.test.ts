import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationConnections, pluggyCredentials } from "@/db/schema";
import { createTestDatabase, seedHousehold } from "@/test/database";

const state = vi.hoisted(() => ({ db: undefined as unknown }));

vi.mock("@/db/client", () => ({ getDb: () => state.db, getServiceDb: () => state.db, asService: <T>(work: () => Promise<T>) => work() }));

const { addConnection, getCredentialsSummary, listConnections, registerConnectedItem, saveCredentials, startConnectSession } =
  await import("./connections");

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

const pluggyOk: Rota = (url) =>
  url.endsWith("/auth")
    ? { status: 200, body: { apiKey: "chave" } }
    : { status: 200, body: { id: ITEM_ID, connector: { name: "Santander" } } };

let membros: Awaited<ReturnType<typeof seedHousehold>>;

beforeEach(async () => {
  vi.stubEnv("ENCRYPTION_KEY", randomBytes(32).toString("base64"));
  const db = await createTestDatabase();
  state.db = db;
  membros = await seedHousehold(db);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("saveCredentials", () => {
  it("salva o secret criptografado depois de validar na Pluggy", async () => {
    simularPluggy(pluggyOk);

    const resultado = await saveCredentials(membros.lucas.id, CLIENT_ID, "pluggy_sk_segredo");

    expect(resultado.ok).toBe(true);
    const db = state.db as Awaited<ReturnType<typeof createTestDatabase>>;
    const [linha] = await db.select().from(pluggyCredentials).where(eq(pluggyCredentials.memberId, membros.lucas.id));
    expect(linha.clientId).toBe(CLIENT_ID);
    expect(linha.clientSecretEncrypted).not.toContain("pluggy_sk_segredo");
  });

  it("substitui as credenciais existentes do mesmo integrante", async () => {
    simularPluggy(pluggyOk);
    await saveCredentials(membros.lucas.id, CLIENT_ID, "segredo-antigo");
    const outroClientId = "11111111-2222-3333-4444-555555555555";

    await saveCredentials(membros.lucas.id, outroClientId, "segredo-novo");

    expect(await getCredentialsSummary(membros.lucas.id)).toMatchObject({ clientId: outroClientId });
  });

  it("não salva credenciais recusadas pela Pluggy", async () => {
    simularPluggy(() => ({ status: 401 }));

    const resultado = await saveCredentials(membros.lucas.id, CLIENT_ID, "errado");

    expect(resultado).toEqual({ ok: false, error: expect.stringContaining("recusou") });
    expect(await getCredentialsSummary(membros.lucas.id)).toBeNull();
  });

  it("valida o formato do Client ID antes de chamar a Pluggy", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    const resultado = await saveCredentials(membros.lucas.id, "nao-e-uuid", "segredo");

    expect(resultado.ok).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("addConnection", () => {
  it("exige credenciais cadastradas", async () => {
    const resultado = await addConnection(membros.lucas.id, ITEM_ID);
    expect(resultado).toEqual({ ok: false, error: expect.stringContaining("credenciais") });
  });

  it("adiciona a conexão com o nome da instituição", async () => {
    simularPluggy(pluggyOk);
    await saveCredentials(membros.lucas.id, CLIENT_ID, "segredo");

    const resultado = await addConnection(membros.lucas.id, ITEM_ID);

    expect(resultado).toEqual({ ok: true, message: "Conexão com Santander adicionada." });
    expect(await listConnections(membros.lucas.id)).toMatchObject([
      { externalItemId: ITEM_ID, institutionName: "Santander", status: "active" },
    ]);
  });

  it("usa o secret descriptografado para autenticar", async () => {
    simularPluggy(pluggyOk);
    await saveCredentials(membros.lucas.id, CLIENT_ID, "segredo-original");
    const chamadas: string[] = [];
    simularPluggy((url, init) => {
      if (url.endsWith("/auth")) {
        chamadas.push(JSON.parse(String(init?.body)).clientSecret);
      }
      return pluggyOk(url, init);
    });

    await addConnection(membros.lucas.id, ITEM_ID);

    expect(chamadas).toEqual(["segredo-original"]);
  });

  it("registra a validade da autorização: um ano quando a Pluggy não informa", async () => {
    simularPluggy(pluggyOk);
    await saveCredentials(membros.lucas.id, CLIENT_ID, "segredo");
    const antes = Date.now();

    await addConnection(membros.lucas.id, ITEM_ID);

    const [conexao] = await listConnections(membros.lucas.id);
    const dias = (conexao.authorizationExpiresAt!.getTime() - antes) / 86_400_000;
    expect(dias).toBeGreaterThan(364.9);
    expect(dias).toBeLessThan(365.1);
  });

  it("usa a validade informada pela Pluggy quando existe", async () => {
    simularPluggy((url) =>
      url.endsWith("/auth")
        ? { status: 200, body: { apiKey: "chave" } }
        : { status: 200, body: { id: ITEM_ID, connector: { name: "Santander" }, consentExpiresAt: "2027-03-01T00:00:00.000Z" } },
    );
    await saveCredentials(membros.lucas.id, CLIENT_ID, "segredo");

    await addConnection(membros.lucas.id, ITEM_ID);

    const [conexao] = await listConnections(membros.lucas.id);
    expect(conexao.authorizationExpiresAt).toEqual(new Date("2027-03-01T00:00:00.000Z"));
  });

  it("não duplica a mesma conexão", async () => {
    simularPluggy(pluggyOk);
    await saveCredentials(membros.lucas.id, CLIENT_ID, "segredo");
    await addConnection(membros.lucas.id, ITEM_ID);

    const resultado = await addConnection(membros.lucas.id, ITEM_ID);

    expect(resultado).toEqual({ ok: false, error: "Essa conexão já está cadastrada." });
    expect(await listConnections(membros.lucas.id)).toHaveLength(1);
  });

  it("recusa item que não pertence às credenciais", async () => {
    simularPluggy((url) => (url.endsWith("/auth") ? { status: 200, body: { apiKey: "chave" } } : { status: 404 }));
    await saveCredentials(membros.lucas.id, CLIENT_ID, "segredo");

    const resultado = await addConnection(membros.lucas.id, ITEM_ID);

    expect(resultado).toEqual({ ok: false, error: expect.stringContaining("não foi encontrado") });
    expect(await listConnections(membros.lucas.id)).toHaveLength(0);
  });

  it("mantém as conexões separadas por titular", async () => {
    simularPluggy(pluggyOk);
    await saveCredentials(membros.lucas.id, CLIENT_ID, "segredo");
    await addConnection(membros.lucas.id, ITEM_ID);

    expect(await listConnections(membros.karina.id)).toHaveLength(0);
  });
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
    await saveCredentials(membros.lucas.id, CLIENT_ID, "segredo");

    const session = await startConnectSession(membros.lucas.id);

    expect(session).toEqual({ ok: true, connectToken: "token-de-conexao", updateItem: null });
    expect(JSON.stringify(session)).not.toContain("segredo");
  });

  it("pede credenciais antes de conectar", async () => {
    expect(await startConnectSession(membros.lucas.id)).toEqual({
      ok: false,
      error: "Cadastre suas credenciais da Pluggy antes de conectar um banco.",
    });
  });

  it("registra o item criado no widget como uma conexão nova", async () => {
    simularPluggy(pluggyConnect(NEW_ITEM, "2027-11-22T10:00:00.000Z"));
    await saveCredentials(membros.lucas.id, CLIENT_ID, "segredo");

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
    await saveCredentials(membros.lucas.id, CLIENT_ID, "segredo");
    await addConnection(membros.lucas.id, ITEM_ID);
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
    await saveCredentials(membros.lucas.id, CLIENT_ID, "segredo");
    simularPluggy(pluggyConnect(ITEM_ID));
    await addConnection(membros.lucas.id, ITEM_ID);
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
    await saveCredentials(membros.lucas.id, CLIENT_ID, "segredo");
    await registerConnectedItem(membros.lucas.id, ITEM_ID);

    const result = await registerConnectedItem(membros.lucas.id, ITEM_ID);

    expect(result.ok).toBe(true);
    expect(await listConnections(membros.lucas.id)).toHaveLength(1);
  });

  it("não deixa conectar o banco que já é de outro integrante", async () => {
    simularPluggy(pluggyConnect());
    await saveCredentials(membros.lucas.id, CLIENT_ID, "segredo");
    await saveCredentials(membros.karina.id, CLIENT_ID, "segredo");
    await registerConnectedItem(membros.lucas.id, ITEM_ID);

    expect(await registerConnectedItem(membros.karina.id, ITEM_ID)).toEqual({
      ok: false,
      error: "Esse banco já foi conectado por outro integrante da residência.",
    });
  });

  it("não renova conexão de outro integrante", async () => {
    simularPluggy(pluggyConnect());
    await saveCredentials(membros.lucas.id, CLIENT_ID, "segredo");
    await saveCredentials(membros.karina.id, CLIENT_ID, "segredo");
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
