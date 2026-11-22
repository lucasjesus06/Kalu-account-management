import "server-only";
import type { ImportedAccount, ImportedBill, ImportedTransaction } from "@/domain/imported";
import { mapAccount, mapBill, mapTransaction } from "./mappers";
import type { PluggyAccount, PluggyBill, PluggyCursorPage, PluggyPage, PluggyTransaction } from "./types";

const DEFAULT_BASE_URL = "https://api.pluggy.ai";
const MAX_PAGES = 200;

function baseUrl() {
  return process.env.PLUGGY_API_URL || DEFAULT_BASE_URL;
}

export type PluggyCredentials = {
  clientId: string;
  clientSecret: string;
};

export type PluggyItemSummary = {
  id: string;
  institutionName: string | null;
  status: string | null;
  errorCode: string | null;
  consentExpiresAt: Date | null;
};

export class PluggyAuthError extends Error {}

export class PluggyNotFoundError extends Error {}

export class PluggyRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function authenticate(credentials: PluggyCredentials) {
  const response = await fetch(`${baseUrl()}/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(credentials),
    cache: "no-store",
  });

  if ([400, 401, 403].includes(response.status)) {
    throw new PluggyAuthError("Credenciais da Pluggy inválidas");
  }
  if (!response.ok) {
    throw new PluggyRequestError(`Falha ao autenticar na Pluggy (HTTP ${response.status})`, response.status);
  }

  const body = (await response.json()) as { apiKey?: unknown };
  if (typeof body.apiKey !== "string" || !body.apiKey) {
    throw new PluggyRequestError("Resposta de autenticação da Pluggy sem apiKey", response.status);
  }
  return body.apiKey;
}

async function get<T>(apiKey: string, url: string, resource: string): Promise<T> {
  const response = await fetch(url.startsWith("http") ? url : `${baseUrl()}${url}`, {
    headers: { "X-API-KEY": apiKey },
    cache: "no-store",
  });

  if (response.status === 401) {
    throw new PluggyAuthError("Chave de acesso da Pluggy inválida ou expirada");
  }
  if ([403, 404].includes(response.status)) {
    throw new PluggyNotFoundError(`${resource} não encontrado para estas credenciais`);
  }
  if (!response.ok) {
    throw new PluggyRequestError(`Falha ao consultar ${resource.toLowerCase()} na Pluggy (HTTP ${response.status})`, response.status);
  }

  return (await response.json()) as T;
}

export async function createConnectToken(apiKey: string, itemId?: string) {
  const response = await fetch(`${baseUrl()}/connect_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-KEY": apiKey },
    body: JSON.stringify({ ...(itemId ? { itemId } : {}), options: { avoidDuplicates: true } }),
    cache: "no-store",
  });

  if (response.status === 401) {
    throw new PluggyAuthError("Chave de acesso da Pluggy inválida ou expirada");
  }
  if ([403, 404].includes(response.status)) {
    throw new PluggyNotFoundError("Item não encontrado para estas credenciais");
  }
  if (!response.ok) {
    throw new PluggyRequestError(`Falha ao abrir a conexão na Pluggy (HTTP ${response.status})`, response.status);
  }

  const body = (await response.json()) as { accessToken?: unknown };
  if (typeof body.accessToken !== "string" || !body.accessToken) {
    throw new PluggyRequestError("Resposta da Pluggy sem token de conexão", response.status);
  }
  return body.accessToken;
}

export async function getItem(apiKey: string, itemId: string): Promise<PluggyItemSummary> {
  const body = await get<{
    id?: unknown;
    status?: unknown;
    connector?: { name?: unknown } | null;
    error?: { code?: unknown } | null;
    consentExpiresAt?: unknown;
  }>(
    apiKey,
    `/items/${encodeURIComponent(itemId)}`,
    "Item",
  );

  return {
    id: typeof body.id === "string" ? body.id : itemId,
    institutionName: typeof body.connector?.name === "string" ? body.connector.name : null,
    status: typeof body.status === "string" ? body.status : null,
    errorCode: typeof body.error?.code === "string" ? body.error.code : null,
    consentExpiresAt:
      typeof body.consentExpiresAt === "string" && !Number.isNaN(Date.parse(body.consentExpiresAt))
        ? new Date(body.consentExpiresAt)
        : null,
  };
}

export async function listAccounts(apiKey: string, itemId: string): Promise<ImportedAccount[]> {
  const page = await get<PluggyPage<PluggyAccount>>(apiKey, `/accounts?itemId=${encodeURIComponent(itemId)}`, "Item");
  return page.results.map(mapAccount);
}

export async function listBills(apiKey: string, account: ImportedAccount): Promise<ImportedBill[]> {
  const bills: ImportedBill[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const body = await get<PluggyPage<PluggyBill>>(
      apiKey,
      `/bills?accountId=${encodeURIComponent(account.externalId)}&page=${page}`,
      "Conta",
    );
    bills.push(...body.results.map((bill) => mapBill(bill, account.externalId)));
    if (body.results.length === 0 || page >= (body.totalPages ?? 1)) {
      return bills;
    }
  }
  throw new PluggyRequestError("Paginação de faturas da Pluggy excedeu o limite de páginas", 200);
}

function nextTransactionsUrl(next: string, currentUrl: string) {
  if (next.startsWith("http") || next.startsWith("/")) {
    return next;
  }
  if (next.startsWith("?")) {
    return `/v2/transactions${next}`;
  }
  const url = new URL(currentUrl, baseUrl());
  url.searchParams.set("after", next);
  return `${url.pathname}${url.search}`;
}

export async function listTransactions(
  apiKey: string,
  account: ImportedAccount,
  options: { createdAtFrom?: string } = {},
): Promise<ImportedTransaction[]> {
  const params = new URLSearchParams({ accountId: account.externalId });
  if (options.createdAtFrom) {
    params.set("createdAtFrom", options.createdAtFrom);
  }

  const transactions: ImportedTransaction[] = [];
  const visited = new Set<string>();
  let url: string | null = `/v2/transactions?${params}`;

  for (let page = 0; url && page < MAX_PAGES; page++) {
    if (visited.has(url)) {
      throw new PluggyRequestError("A Pluggy repetiu o cursor de paginação de transações", 200);
    }
    visited.add(url);

    const body: PluggyCursorPage<PluggyTransaction> = await get(apiKey, url, "Conta");
    transactions.push(...body.results.map((transaction) => mapTransaction(transaction, account)));
    url = body.next ? nextTransactionsUrl(body.next, url) : null;
  }

  if (url) {
    throw new PluggyRequestError("Paginação de transações da Pluggy excedeu o limite de páginas", 200);
  }
  return transactions;
}
