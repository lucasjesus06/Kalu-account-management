import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationConnections, pluggyCredentials } from "@/db/schema";
import { createTestDatabase, seedHousehold } from "@/test/database";

const state = vi.hoisted(() => ({ db: undefined as unknown }));

vi.mock("@/db/client", () => ({ getDb: () => state.db, getServiceDb: () => state.db, asService: <T>(work: () => Promise<T>) => work() }));

const { startConnectSession } = await import("./connections");
const { forgetAppApiKey, pluggyAvailableFor, pluggyClientIdFor } = await import("./pluggy-app");
const { removeOwnCredentials, saveOwnCredentials } = await import("./own-credentials");

type TestDb = Awaited<ReturnType<typeof createTestDatabase>>;
const db = () => state.db as TestDb;

const APP_CLIENT_ID = "593ce5a5-bd0f-47d1-af52-50d0acb74bee";
const OWN_CLIENT_ID = "11111111-2222-4333-8444-555555555555";
const OWN_SECRET = "segredo-do-casal-amigo";
const ITEM_ID = "2eaac5ff-57cb-49bd-b51e-cd6f39ba56d3";

let membros: Awaited<ReturnType<typeof seedHousehold>>;
let autenticacoes: { clientId: string; clientSecret: string }[];

function simularPluggy(aceitaCredencial = true) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/auth")) {
        const body = JSON.parse(String(init?.body));
        autenticacoes.push(body);
        return new Response(JSON.stringify(aceitaCredencial ? { apiKey: "chave" } : {}), { status: aceitaCredencial ? 200 : 401 });
      }
      if (url.endsWith("/connect_token")) {
        return new Response(JSON.stringify({ accessToken: "token" }), { status: 200 });
      }
      return new Response(JSON.stringify({ results: [] }), { status: 200 });
    }),
  );
}

beforeEach(async () => {
  vi.stubEnv("PLUGGY_CLIENT_ID", APP_CLIENT_ID);
  vi.stubEnv("PLUGGY_CLIENT_SECRET", "segredo-do-lucas");
  vi.stubEnv("ENCRYPTION_KEY", randomBytes(32).toString("base64"));
  vi.stubEnv("PLUGGY_WEBHOOK_SECRET", "");
  forgetAppApiKey();
  autenticacoes = [];
  state.db = await createTestDatabase();
  membros = await seedHousehold(db());
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("credenciais próprias da Pluggy", () => {
  it("valida na Pluggy e guarda o segredo criptografado", async () => {
    simularPluggy();

    const result = await saveOwnCredentials(membros.karina.id, ` ${OWN_CLIENT_ID} `, ` ${OWN_SECRET} `);

    expect(result.ok).toBe(true);
    expect(autenticacoes[0]).toEqual({ clientId: OWN_CLIENT_ID, clientSecret: OWN_SECRET });
    const [row] = await db().select().from(pluggyCredentials);
    expect(row).toMatchObject({ memberId: membros.karina.id, clientId: OWN_CLIENT_ID });
    expect(row.clientSecretEncrypted).not.toContain(OWN_SECRET);
  });

  it("não guarda credenciais que a Pluggy recusa", async () => {
    simularPluggy(false);

    const result = await saveOwnCredentials(membros.karina.id, OWN_CLIENT_ID, "errado");

    expect(result).toEqual({ ok: false, error: "A Pluggy não aceitou essas credenciais. Confira o Client ID e o Client Secret." });
    expect(await db().select().from(pluggyCredentials)).toHaveLength(0);
  });

  it("exige os dois campos e a chave de criptografia", async () => {
    simularPluggy();

    expect((await saveOwnCredentials(membros.karina.id, OWN_CLIENT_ID, "  ")).ok).toBe(false);
    vi.stubEnv("ENCRYPTION_KEY", "");
    expect(await saveOwnCredentials(membros.karina.id, OWN_CLIENT_ID, OWN_SECRET)).toEqual({
      ok: false,
      error: "O Kalu ainda não está preparado para guardar credenciais neste ambiente.",
    });
    expect(autenticacoes).toHaveLength(0);
  });

  it("não troca nem remove as credenciais depois da primeira conexão", async () => {
    simularPluggy();
    await saveOwnCredentials(membros.karina.id, OWN_CLIENT_ID, OWN_SECRET);
    await db().insert(integrationConnections).values({ memberId: membros.karina.id, externalItemId: ITEM_ID });

    const troca = await saveOwnCredentials(membros.karina.id, "outro-id", "outro-segredo");
    const remocao = await removeOwnCredentials(membros.karina.id);

    expect(troca.ok).toBe(false);
    expect(remocao.ok).toBe(false);
    expect((await db().select().from(pluggyCredentials))[0].clientId).toBe(OWN_CLIENT_ID);
  });

  it("remove as credenciais enquanto não há conexões", async () => {
    simularPluggy();
    await saveOwnCredentials(membros.karina.id, OWN_CLIENT_ID, OWN_SECRET);

    expect((await removeOwnCredentials(membros.karina.id)).ok).toBe(true);
    expect(await db().select().from(pluggyCredentials).where(eq(pluggyCredentials.memberId, membros.karina.id))).toHaveLength(0);
  });

  it("usa a credencial de quem pediu e mantém a do Kalu para os demais", async () => {
    simularPluggy();
    await saveOwnCredentials(membros.karina.id, OWN_CLIENT_ID, OWN_SECRET);
    autenticacoes = [];
    forgetAppApiKey();

    expect((await startConnectSession(membros.karina.id)).ok).toBe(true);
    expect((await startConnectSession(membros.lucas.id)).ok).toBe(true);

    expect(autenticacoes).toEqual([
      { clientId: OWN_CLIENT_ID, clientSecret: OWN_SECRET },
      { clientId: APP_CLIENT_ID, clientSecret: "segredo-do-lucas" },
    ]);
    expect(await pluggyClientIdFor(membros.karina.id)).toBe(OWN_CLIENT_ID);
    expect(await pluggyClientIdFor(membros.lucas.id)).toBe(APP_CLIENT_ID);
  });

  it("libera a conexão para quem tem credencial própria mesmo sem as do Kalu", async () => {
    simularPluggy();
    vi.stubEnv("PLUGGY_CLIENT_ID", "");
    vi.stubEnv("PLUGGY_CLIENT_SECRET", "");
    expect(await pluggyAvailableFor(membros.karina.id)).toBe(false);

    await saveOwnCredentials(membros.karina.id, OWN_CLIENT_ID, OWN_SECRET);

    expect(await pluggyAvailableFor(membros.karina.id)).toBe(true);
    expect(await pluggyAvailableFor(membros.lucas.id)).toBe(false);
  });
});
