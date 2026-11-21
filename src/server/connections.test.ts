import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pluggyCredentials } from "@/db/schema";
import { createTestDatabase, seedHousehold } from "@/test/database";

const state = vi.hoisted(() => ({ db: undefined as unknown }));

vi.mock("@/db/client", () => ({ getDb: () => state.db }));

const { addConnection, getCredentialsSummary, listConnections, saveCredentials } = await import("./connections");

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
