import { afterEach, describe, expect, it, vi } from "vitest";
import accountsFixture from "./__fixtures__/accounts.json";
import billsFixture from "./__fixtures__/bills.json";
import cardTransactionsFixture from "./__fixtures__/card-transactions.json";
import {
  authenticate,
  getItem,
  listAccounts,
  listBills,
  listTransactions,
  PluggyAuthError,
  PluggyNotFoundError,
  PluggyRequestError,
} from "./client";
import { mapAccount } from "./mappers";
import type { PluggyAccount } from "./types";

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
      errorCode: null,
      consentExpiresAt: null,
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
      errorCode: null,
      consentExpiresAt: null,
    });
  });

  it("lê o código de erro e a validade da autorização", async () => {
    vi.stubGlobal(
      "fetch",
      respostaFalsa(200, {
        id: "item-1",
        status: "LOGIN_ERROR",
        error: { code: "USER_AUTHORIZATION_EXPIRED", message: "expirou" },
        consentExpiresAt: "2027-11-19T17:52:45.000Z",
      }),
    );
    await expect(getItem("chave-123", "item-1")).resolves.toMatchObject({
      status: "LOGIN_ERROR",
      errorCode: "USER_AUTHORIZATION_EXPIRED",
      consentExpiresAt: new Date("2027-11-19T17:52:45.000Z"),
    });
  });

  it("ignora data de validade inválida", async () => {
    vi.stubGlobal("fetch", respostaFalsa(200, { id: "item-1", consentExpiresAt: "não é data" }));
    await expect(getItem("chave-123", "item-1")).resolves.toMatchObject({ consentExpiresAt: null });
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

function rotas(handler: (url: URL) => { status: number; body?: unknown }) {
  const fetch = vi.fn(async (input: string) => {
    const { status, body = {} } = handler(new URL(input));
    return new Response(JSON.stringify(body), { status });
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

const cartao = mapAccount(accountsFixture.results[1] as PluggyAccount);

describe("listAccounts", () => {
  it("busca as contas do item e devolve no modelo interno", async () => {
    const fetch = rotas(() => ({ status: 200, body: accountsFixture }));

    const contas = await listAccounts("chave-123", "item-1");

    expect(contas.map((c) => [c.kind, c.numberLast4])).toEqual([
      ["checking", "9991"],
      ["credit_card", "1234"],
    ]);
    expect(fetch.mock.calls[0][0]).toBe("https://api.pluggy.ai/accounts?itemId=item-1");
  });

  it("trata HTTP 401 como chave de acesso inválida", async () => {
    rotas(() => ({ status: 401 }));
    await expect(listAccounts("chave-velha", "item-1")).rejects.toBeInstanceOf(PluggyAuthError);
  });
});

describe("listBills", () => {
  it("percorre todas as páginas de faturas", async () => {
    const [primeira, segunda] = billsFixture.results;
    const fetch = rotas((url) =>
      url.searchParams.get("page") === "1"
        ? { status: 200, body: { totalPages: 2, page: 1, results: [primeira] } }
        : { status: 200, body: { totalPages: 2, page: 2, results: [segunda] } },
    );

    const faturas = await listBills("chave-123", cartao);

    expect(faturas.map((f) => [f.dueDate, f.totalCents])).toEqual([
      ["2026-11-03", 403477],
      ["2026-10-03", 636517],
    ]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("para quando a página vem vazia", async () => {
    const fetch = rotas(() => ({ status: 200, body: { results: [] } }));
    await expect(listBills("chave-123", cartao)).resolves.toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("listTransactions", () => {
  const [a, b, c] = cardTransactionsFixture.results;

  it("segue o cursor next até o fim, aceitando query string ou URL completa", async () => {
    const fetch = rotas((url) => {
      if (url.searchParams.get("after") === "cursor-2") {
        return { status: 200, body: { results: [c], next: null } };
      }
      if (url.searchParams.get("after") === "cursor-1") {
        return { status: 200, body: { results: [b], next: `https://api.pluggy.ai/v2/transactions?accountId=${cartao.externalId}&after=cursor-2` } };
      }
      return { status: 200, body: { results: [a], next: `?accountId=${cartao.externalId}&after=cursor-1` } };
    });

    const transacoes = await listTransactions("chave-123", cartao);

    expect(transacoes.map((t) => t.externalId)).toEqual([a.id, b.id, c.id]);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(String(fetch.mock.calls[0][0])).toBe(`https://api.pluggy.ai/v2/transactions?accountId=${cartao.externalId}`);
  });

  it("aceita cursor puro no next", async () => {
    rotas((url) =>
      url.searchParams.get("after") === "abc" ? { status: 200, body: { results: [b] } } : { status: 200, body: { results: [a], next: "abc" } },
    );
    await expect(listTransactions("chave-123", cartao)).resolves.toHaveLength(2);
  });

  it("envia o filtro de data de criação quando informado", async () => {
    const fetch = rotas(() => ({ status: 200, body: { results: [] } }));
    await listTransactions("chave-123", cartao, { createdAtFrom: "2026-11-01T00:00:00.000Z" });
    expect(new URL(fetch.mock.calls[0][0]).searchParams.get("createdAtFrom")).toBe("2026-11-01T00:00:00.000Z");
  });

  it("interrompe se a Pluggy repetir o mesmo cursor", async () => {
    rotas(() => ({ status: 200, body: { results: [a], next: "?accountId=x&after=sempre-o-mesmo" } }));
    await expect(listTransactions("chave-123", cartao)).rejects.toThrow("repetiu o cursor");
  });

  it("propaga conta não encontrada", async () => {
    rotas(() => ({ status: 404 }));
    await expect(listTransactions("chave-123", cartao)).rejects.toBeInstanceOf(PluggyNotFoundError);
  });
});
