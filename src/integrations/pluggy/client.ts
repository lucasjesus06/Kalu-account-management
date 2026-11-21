import "server-only";

const BASE_URL = "https://api.pluggy.ai";

export type PluggyCredentials = {
  clientId: string;
  clientSecret: string;
};

export type PluggyItemSummary = {
  id: string;
  institutionName: string | null;
  status: string | null;
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
  const response = await fetch(`${BASE_URL}/auth`, {
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

export async function getItem(apiKey: string, itemId: string): Promise<PluggyItemSummary> {
  const response = await fetch(`${BASE_URL}/items/${encodeURIComponent(itemId)}`, {
    headers: { "X-API-KEY": apiKey },
    cache: "no-store",
  });

  if ([403, 404].includes(response.status)) {
    throw new PluggyNotFoundError("Item não encontrado para estas credenciais");
  }
  if (!response.ok) {
    throw new PluggyRequestError(`Falha ao consultar item na Pluggy (HTTP ${response.status})`, response.status);
  }

  const body = (await response.json()) as {
    id?: unknown;
    status?: unknown;
    connector?: { name?: unknown } | null;
  };

  return {
    id: typeof body.id === "string" ? body.id : itemId,
    institutionName: typeof body.connector?.name === "string" ? body.connector.name : null,
    status: typeof body.status === "string" ? body.status : null,
  };
}
