import { afterEach, describe, expect, it, vi } from "vitest";
import {
  authenticate,
  getItem,
  PluggyAuthError,
  PluggyNotFoundError,
  PluggyRequestError,
} from "./client";

function respostaFalsa(status: number, body: unknown = {}) {
  return vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));
}

const credenciais = { clientId: "id-exemplo", clientSecret: "segredo-exemplo" };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("authenticate", () => {
  it("retorna a apiKey e envia as credenciais no corpo", async () => {
    const fetch = respostaFalsa(200, { apiKey: "chave-123" });
    vi.stubGlobal("fetch", fetch);

    await expect(authenticate(credenciais)).resolves.toBe("chave-123");

    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://api.pluggy.ai/auth");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual(credenciais);
  });

  it.each([400, 401, 403])("trata HTTP %i como credencial inválida", async (status) => {
    vi.stubGlobal("fetch", respostaFalsa(status));
    await expect(authenticate(credenciais)).rejects.toBeInstanceOf(PluggyAuthError);
  });

  it("trata erro do servidor como falha de requisição", async () => {
    vi.stubGlobal("fetch", respostaFalsa(500));
    await expect(authenticate(credenciais)).rejects.toBeInstanceOf(PluggyRequestError);
  });

  it("rejeita resposta sem apiKey", async () => {
    vi.stubGlobal("fetch", respostaFalsa(200, {}));
    await expect(authenticate(credenciais)).rejects.toBeInstanceOf(PluggyRequestError);
  });
});

describe("getItem", () => {
  it("retorna o resumo do item com o nome da instituição", async () => {
    const fetch = respostaFalsa(200, {
      id: "item-1",
      status: "UPDATED",
      connector: { name: "Santander" },
    });
    vi.stubGlobal("fetch", fetch);

    await expect(getItem("chave-123", "item-1")).resolves.toEqual({
      id: "item-1",
      institutionName: "Santander",
      status: "UPDATED",
    });

    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://api.pluggy.ai/items/item-1");
    expect(init.headers).toEqual({ "X-API-KEY": "chave-123" });
  });

  it("aceita item sem dados do conector", async () => {
    vi.stubGlobal("fetch", respostaFalsa(200, { id: "item-1" }));
    await expect(getItem("chave-123", "item-1")).resolves.toEqual({
      id: "item-1",
      institutionName: null,
      status: null,
    });
  });

  it.each([403, 404])("trata HTTP %i como item não encontrado", async (status) => {
    vi.stubGlobal("fetch", respostaFalsa(status));
    await expect(getItem("chave-123", "item-1")).rejects.toBeInstanceOf(PluggyNotFoundError);
  });

  it("trata erro do servidor como falha de requisição", async () => {
    vi.stubGlobal("fetch", respostaFalsa(502));
    await expect(getItem("chave-123", "item-1")).rejects.toBeInstanceOf(PluggyRequestError);
  });
});
