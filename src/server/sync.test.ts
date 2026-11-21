import { randomBytes } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  categories,
  creditCardBills,
  financialAccounts,
  integrationConnections,
  pluggyCredentials,
  syncRuns,
  transactions,
} from "@/db/schema";
import accountsFixture from "@/integrations/pluggy/__fixtures__/accounts.json";
import bankTransactionsFixture from "@/integrations/pluggy/__fixtures__/bank-transactions.json";
import billsFixture from "@/integrations/pluggy/__fixtures__/bills.json";
import cardTransactionsFixture from "@/integrations/pluggy/__fixtures__/card-transactions.json";
import { createTestDatabase, seedHousehold } from "@/test/database";

const state = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("@/db/client", () => ({ getDb: () => state.db }));

const { encrypt } = await import("./crypto");
const { latestSyncRuns, syncAllConnections, syncConnection } = await import("./sync");
const { listHouseholdAccounts } = await import("./accounts");
const { listHouseholdCardBills } = await import("./bills");

type TestDb = Awaited<ReturnType<typeof createTestDatabase>>;
const db = () => state.db as TestDb;

const ITEM_ID = "2eaac5ff-57cb-49bd-b51e-cd6f39ba56d3";
const CARD_ID = "f9dd22a9-84dd-470d-8d0e-63a02537d5bc";
const NOVEMBER_BILL = "0c15574b-9488-4556-a388-d3891cd01bfd";
const PENDING_ID = "aa11aa11-0000-4000-8000-000000000001";

type Fixtures = {
  item: Record<string, unknown>;
  accounts: typeof accountsFixture.results;
  cardTransactions: typeof cardTransactionsFixture.results;
  bills: typeof billsFixture.results;
  authStatus: number;
  accountsStatus: number;
};

let fixtures: Fixtures;
let connectionId: string;
let householdId: string;
let karinaId: string;

function simulatePluggy() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      const url = new URL(input);
      const json = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status });
      if (url.pathname === "/auth") {
        return fixtures.authStatus === 200 ? json(200, { apiKey: "chave" }) : json(fixtures.authStatus);
      }
      if (url.pathname === `/items/${ITEM_ID}`) {
        return json(200, fixtures.item);
      }
      if (url.pathname === "/accounts") {
        return fixtures.accountsStatus === 200 ? json(200, { results: fixtures.accounts }) : json(fixtures.accountsStatus);
      }
      if (url.pathname === "/bills") {
        return json(200, { totalPages: 1, results: fixtures.bills });
      }
      if (url.pathname === "/v2/transactions") {
        return url.searchParams.get("accountId") === CARD_ID
          ? json(200, { results: fixtures.cardTransactions, next: null })
          : json(200, bankTransactionsFixture);
      }
      return json(404);
    }),
  );
}

beforeEach(async () => {
  vi.stubEnv("ENCRYPTION_KEY", randomBytes(32).toString("base64"));
  state.db = await createTestDatabase();
  const { household, lucas, karina } = await seedHousehold(db());
  householdId = household.id;
  karinaId = karina.id;
  await db()
    .insert(pluggyCredentials)
    .values({ memberId: lucas.id, clientId: "593ce5a5-bd0f-47d1-af52-50d0acb74bee", clientSecretEncrypted: encrypt("segredo") });
  const [connection] = await db()
    .insert(integrationConnections)
    .values({ memberId: lucas.id, externalItemId: ITEM_ID, institutionName: "Santander" })
    .returning();
  connectionId = connection.id;
  fixtures = {
    item: { id: ITEM_ID, status: "UPDATED", connector: { name: "Santander" } },
    accounts: structuredClone(accountsFixture.results),
    cardTransactions: structuredClone(cardTransactionsFixture.results),
    bills: structuredClone(billsFixture.results),
    authStatus: 200,
    accountsStatus: 200,
  };
  simulatePluggy();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function counts() {
  return {
    accounts: await db().$count(financialAccounts),
    bills: await db().$count(creditCardBills),
    transactions: await db().$count(transactions),
  };
}

describe("syncConnection", () => {
  it("importa contas, faturas e transações", async () => {
    const result = await syncConnection(connectionId);

    expect(result).toEqual({
      ok: true,
      accounts: 2,
      bills: 2,
      transactions: 10,
      changes: { created: 10, updated: 0, removed: 0 },
    });
    expect(await counts()).toEqual({ accounts: 2, bills: 2, transactions: 10 });

    const [card] = await db().select().from(financialAccounts).where(eq(financialAccounts.externalId, CARD_ID));
    expect(card).toMatchObject({ kind: "credit_card", numberLast4: "1234", creditUsedCents: 799275, creditLimitCents: 800000 });
  });

  it("vincula cada compra à fatura pelo identificador da fonte", async () => {
    await syncConnection(connectionId);

    const [november] = await db().select().from(creditCardBills).where(eq(creditCardBills.externalId, NOVEMBER_BILL));
    const linked = await db()
      .select({ externalId: transactions.externalId })
      .from(transactions)
      .where(eq(transactions.billId, november.id))
      .orderBy(asc(transactions.externalId));

    expect(linked.map((t) => t.externalId)).toEqual([
      "6af5f200-2ac8-4a62-909d-18faadb7dd62",
      "aa11aa11-0000-4000-8000-000000000003",
      "aa11aa11-0000-4000-8000-000000000004",
    ]);
  });

  it("não duplica nada ao sincronizar de novo", async () => {
    await syncConnection(connectionId);
    const second = await syncConnection(connectionId);

    expect(second).toMatchObject({ ok: true, changes: { created: 0, updated: 0, removed: 0 } });
    expect(await counts()).toEqual({ accounts: 2, bills: 2, transactions: 10 });
  });

  it("não regrava o que não mudou", async () => {
    await syncConnection(connectionId);
    const transactionsBefore = await db().select({ id: transactions.id, updatedAt: transactions.updatedAt }).from(transactions);
    const accountsBefore = await db().select({ id: financialAccounts.id, updatedAt: financialAccounts.updatedAt }).from(financialAccounts);

    await syncConnection(connectionId);

    const transactionsAfter = await db().select({ id: transactions.id, updatedAt: transactions.updatedAt }).from(transactions);
    const accountsAfter = await db().select({ id: financialAccounts.id, updatedAt: financialAccounts.updatedAt }).from(financialAccounts);
    expect(transactionsAfter).toEqual(expect.arrayContaining(transactionsBefore));
    expect(accountsAfter).toEqual(expect.arrayContaining(accountsBefore));
  });

  it("vincula à fatura uma compra já importada quando a fatura chega depois", async () => {
    fixtures.bills = [];
    await syncConnection(connectionId);
    fixtures.bills = structuredClone(billsFixture.results);

    const result = await syncConnection(connectionId);

    const [purchase] = await db()
      .select()
      .from(transactions)
      .where(eq(transactions.externalId, "aa11aa11-0000-4000-8000-000000000004"));
    expect(purchase.billId).not.toBeNull();
    expect(result).toMatchObject({ changes: { created: 0, updated: 5, removed: 0 } });
  });

  it("atualiza transação existente quando a fonte muda", async () => {
    await syncConnection(connectionId);
    fixtures.cardTransactions = fixtures.cardTransactions.map((t) =>
      t.id === PENDING_ID ? { ...t, status: "POSTED", amount: 7.5 } : t,
    );

    const result = await syncConnection(connectionId);

    const [updated] = await db().select().from(transactions).where(eq(transactions.externalId, PENDING_ID));
    expect(updated).toMatchObject({ status: "posted", amountCents: 750 });
    expect(result).toMatchObject({ changes: { created: 0, updated: 1, removed: 0 } });
  });

  it("remove transação pendente que a fonte deixou de enviar", async () => {
    await syncConnection(connectionId);
    fixtures.cardTransactions = fixtures.cardTransactions.filter((t) => t.id !== PENDING_ID);

    const result = await syncConnection(connectionId);

    expect(await db().$count(transactions, eq(transactions.externalId, PENDING_ID))).toBe(0);
    expect(await db().$count(transactions)).toBe(9);
    expect(result).toMatchObject({ changes: { created: 0, updated: 0, removed: 1 } });
  });

  it("mantém transação já lançada mesmo que a fonte deixe de enviar", async () => {
    await syncConnection(connectionId);
    fixtures.cardTransactions = fixtures.cardTransactions.filter((t) => t.status !== "POSTED");

    await syncConnection(connectionId);

    expect(await db().$count(transactions)).toBe(10);
  });

  it("guarda o identificador da fatura mesmo quando a fatura não veio", async () => {
    fixtures.bills = [];

    await syncConnection(connectionId);

    const [purchase] = await db()
      .select()
      .from(transactions)
      .where(eq(transactions.externalId, "aa11aa11-0000-4000-8000-000000000004"));
    expect(purchase).toMatchObject({ billId: null, billExternalId: NOVEMBER_BILL });
  });

  it("registra a execução e o horário da última sincronização", async () => {
    await syncConnection(connectionId);

    const [run] = await db().select().from(syncRuns);
    expect(run).toMatchObject({
      status: "succeeded",
      accountsCount: 2,
      billsCount: 2,
      transactionsCount: 10,
      transactionsCreated: 10,
      transactionsUpdated: 0,
      transactionsRemoved: 0,
      error: null,
    });
    expect(run.finishedAt).toBeInstanceOf(Date);
    const [connection] = await db().select().from(integrationConnections);
    expect(connection.lastSyncedAt).toBeInstanceOf(Date);
    expect((await latestSyncRuns([connectionId])).get(connectionId)?.status).toBe("succeeded");
  });

  it("marca a conexão com erro quando a Pluggy recusa as credenciais", async () => {
    fixtures.authStatus = 401;

    const result = await syncConnection(connectionId);

    expect(result).toEqual({ ok: false, error: expect.stringContaining("recusou as credenciais") });
    const [connection] = await db().select().from(integrationConnections);
    expect(connection.status).toBe("error");
    const [run] = await db().select().from(syncRuns);
    expect(run).toMatchObject({ status: "failed", error: expect.stringContaining("recusou") });
    expect(await counts()).toEqual({ accounts: 0, bills: 0, transactions: 0 });
  });

  it("marca a conexão com erro quando o banco não existe mais nas credenciais", async () => {
    fixtures.accountsStatus = 404;

    const result = await syncConnection(connectionId);

    expect(result).toEqual({ ok: false, error: expect.stringContaining("não encontrou este banco") });
    const [connection] = await db().select().from(integrationConnections);
    expect(connection.status).toBe("error");
  });

  it("volta a conexão para ativa depois de uma sincronização bem-sucedida", async () => {
    fixtures.authStatus = 401;
    await syncConnection(connectionId);
    fixtures.authStatus = 200;

    await syncConnection(connectionId);

    const [connection] = await db().select().from(integrationConnections);
    expect(connection.status).toBe("active");
    expect((await latestSyncRuns([connectionId])).get(connectionId)?.status).toBe("succeeded");
  });
});

describe("listHouseholdAccounts", () => {
  it("lista as contas da residência com titular e totais importados", async () => {
    await syncConnection(connectionId);

    const accounts = await listHouseholdAccounts(householdId);

    expect(
      accounts.map((a) => ({ kind: a.kind, owner: a.ownerName, bank: a.institutionName, tx: a.transactionsCount, bills: a.billsCount })),
    ).toEqual([
      { kind: "checking", owner: "Lucas", bank: "Santander", tx: 2, bills: 0 },
      { kind: "credit_card", owner: "Lucas", bank: "Santander", tx: 8, bills: 2 },
    ]);
  });

  it("não mostra contas de outra residência", async () => {
    await syncConnection(connectionId);
    const { household: outra } = await seedHousehold(db());

    expect(await listHouseholdAccounts(outra.id)).toEqual([]);
  });
});

describe("trava de sincronização", () => {
  it("não inicia outra sincronização enquanto uma está em andamento", async () => {
    await db().insert(syncRuns).values({ connectionId });

    const result = await syncConnection(connectionId);

    expect(result).toEqual({ ok: false, error: "Já existe uma sincronização em andamento para esta conexão." });
    expect(fetch).not.toHaveBeenCalled();
    expect(await counts()).toEqual({ accounts: 0, bills: 0, transactions: 0 });
  });

  it("libera execução travada há mais de 15 minutos", async () => {
    await db()
      .insert(syncRuns)
      .values({ connectionId, startedAt: new Date(Date.now() - 16 * 60 * 1000) });

    const result = await syncConnection(connectionId);

    expect(result.ok).toBe(true);
    const runs = await db().select().from(syncRuns).orderBy(asc(syncRuns.startedAt));
    expect(runs.map((r) => [r.status, r.error])).toEqual([
      ["failed", "Sincronização interrompida antes de terminar."],
      ["succeeded", null],
    ]);
  });

  it("duas sincronizações ao mesmo tempo: só uma roda", async () => {
    const results = await Promise.all([syncConnection(connectionId), syncConnection(connectionId)]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([
      { ok: false, error: "Já existe uma sincronização em andamento para esta conexão." },
    ]);
    expect(await counts()).toEqual({ accounts: 2, bills: 2, transactions: 10 });
  });
});

describe("autorização expirada", () => {
  const expiredMessage = "A autorização desta conexão expirou. Renove a conexão no Meu Pluggy para voltar a sincronizar.";

  async function connectionStatus() {
    const [connection] = await db().select().from(integrationConnections);
    return connection;
  }

  it.each([
    ["código de erro da Pluggy", { error: { code: "USER_AUTHORIZATION_EXPIRED" } }],
    ["item com erro de login", { status: "LOGIN_ERROR" }],
  ])("detecta pelo %s e não altera os dados", async (_motivo, item) => {
    await syncConnection(connectionId);
    fixtures.item = { ...fixtures.item, ...item };

    const result = await syncConnection(connectionId);

    expect(result).toEqual({ ok: false, error: expiredMessage });
    expect((await connectionStatus()).status).toBe("expired");
    expect(await counts()).toEqual({ accounts: 2, bills: 2, transactions: 10 });
  });

  it("detecta pela data de validade vencida", async () => {
    await db().update(integrationConnections).set({ authorizationExpiresAt: new Date(Date.now() - 1000) });

    const result = await syncConnection(connectionId);

    expect(result).toEqual({ ok: false, error: expiredMessage });
    expect((await connectionStatus()).status).toBe("expired");
  });

  it("atualiza a validade quando a Pluggy informa uma nova data", async () => {
    await db().update(integrationConnections).set({ authorizationExpiresAt: new Date(Date.now() - 1000) });
    fixtures.item = { ...fixtures.item, consentExpiresAt: "2099-01-01T00:00:00.000Z" };

    const result = await syncConnection(connectionId);

    expect(result.ok).toBe(true);
    expect((await connectionStatus()).authorizationExpiresAt).toEqual(new Date("2099-01-01T00:00:00.000Z"));
  });

  it("trata retorno sem contas, de uma conexão que já tinha contas, como falha", async () => {
    await syncConnection(connectionId);
    fixtures.accounts = [];

    const result = await syncConnection(connectionId);

    expect(result).toEqual({ ok: false, error: expect.stringContaining("não retornou nenhuma conta") });
    expect((await connectionStatus()).status).toBe("error");
    expect(await counts()).toEqual({ accounts: 2, bills: 2, transactions: 10 });
  });

  it("aceita conexão nova ainda sem contas", async () => {
    fixtures.accounts = [];

    const result = await syncConnection(connectionId);

    expect(result).toEqual({
      ok: true,
      accounts: 0,
      bills: 0,
      transactions: 0,
      changes: { created: 0, updated: 0, removed: 0 },
    });
  });
});

describe("syncAllConnections", () => {
  it("sincroniza cada conexão, sem que a falha de uma impeça as outras, e ignora as revogadas", async () => {
    const [semCredenciais] = await db()
      .insert(integrationConnections)
      .values({ memberId: karinaId, externalItemId: "item-da-karina", institutionName: "Nubank" })
      .returning();
    await db()
      .insert(integrationConnections)
      .values({ memberId: karinaId, externalItemId: "item-revogado", institutionName: "Inter", status: "revoked" });

    const summary = await syncAllConnections();

    expect(summary).toMatchObject({ total: 2, succeeded: 1, failed: 1 });
    expect(summary.results).toEqual([
      { connectionId, result: expect.objectContaining({ ok: true, transactions: 10 }) },
      { connectionId: semCredenciais.id, result: { ok: false, error: expect.any(String) } },
    ]);
    expect(await db().$count(syncRuns)).toBe(2);
  });
});

describe("listHouseholdCardBills", () => {
  it("compõe as faturas dos cartões da residência com os dados sincronizados", async () => {
    await syncConnection(connectionId);
    const [card] = await db().select().from(financialAccounts).where(eq(financialAccounts.externalId, CARD_ID));

    const bills = await listHouseholdCardBills(householdId);

    expect([...bills.keys()]).toEqual([card.id]);
    const { open, closed } = bills.get(card.id)!;
    expect(open).toMatchObject({ purchasesCents: 6682, pendingCents: 600, billPaymentsCents: 403477, netCents: 6682 });
    expect(closed.map((bill) => [bill.dueDate, bill.officialTotalCents, bill.netCents, bill.unidentifiedCents, bill.incomplete])).toEqual([
      ["2026-11-03", 403477, 124876, 403477 - 124876, false],
      ["2026-10-03", 636517, 5412 - 729, 636517 - 4683, true],
    ]);
    expect(closed[0].billPaymentsCents).toBe(636517);
  });

  it("não traz cartões de outra residência", async () => {
    await syncConnection(connectionId);
    const outra = await seedHousehold(db());

    expect((await listHouseholdCardBills(outra.household.id)).size).toBe(0);
  });
});

describe("categorização na sincronização", () => {
  async function categoryOf(externalId: string) {
    const [row] = await db()
      .select({
        merchantName: transactions.merchantName,
        category: categories.slug,
        source: transactions.categorySource,
      })
      .from(transactions)
      .leftJoin(categories, eq(categories.id, transactions.categoryId))
      .where(eq(transactions.externalId, externalId));
    return row;
  }

  async function setCategory(externalId: string, slug: string, source: "automatic" | "user") {
    const [category] = await db().select().from(categories).where(eq(categories.slug, slug));
    await db()
      .update(transactions)
      .set({ categoryId: category.id, categorySource: source })
      .where(eq(transactions.externalId, externalId));
  }

  it("categoriza as transações importadas e guarda o estabelecimento", async () => {
    await syncConnection(connectionId);

    expect(await categoryOf(PENDING_ID)).toEqual({ merchantName: "UBER", category: "transporte-por-aplicativo", source: "automatic" });
    expect(await categoryOf("aa11aa11-0000-4000-8000-000000000005")).toEqual({
      merchantName: "COMPANHIA TESTE",
      category: "restaurantes",
      source: "automatic",
    });
    expect(await categoryOf("6af5f200-2ac8-4a62-909d-18faadb7dd62")).toMatchObject({ merchantName: "LOJA TESTE", category: "compras" });
    expect(await categoryOf("aa11aa11-0000-4000-8000-000000000006")).toMatchObject({ category: "assinaturas" });
  });

  it("deixa sem categoria o pagamento de fatura, registrando que já foi avaliado", async () => {
    await syncConnection(connectionId);

    expect(await categoryOf("aa11aa11-0000-4000-8000-000000000002")).toEqual({
      merchantName: "PAGAMENTO DE FATURA",
      category: null,
      source: "automatic",
    });
  });

  it("não reclassifica o que já foi categorizado quando nada mudou", async () => {
    await syncConnection(connectionId);
    await setCategory(PENDING_ID, "outros", "automatic");

    await syncConnection(connectionId);

    expect(await categoryOf(PENDING_ID)).toMatchObject({ category: "outros", source: "automatic" });
  });

  it("reclassifica a categoria automática quando a descrição muda na fonte", async () => {
    await syncConnection(connectionId);
    await setCategory(PENDING_ID, "outros", "automatic");
    fixtures.cardTransactions = fixtures.cardTransactions.map((t) =>
      t.id === PENDING_ID ? { ...t, description: "DROGASIL 123" } : t,
    );

    await syncConnection(connectionId);

    expect(await categoryOf(PENDING_ID)).toEqual({ merchantName: "DROGASIL 123", category: "farmacia", source: "automatic" });
  });

  it("nunca sobrescreve a categoria escolhida pelo usuário", async () => {
    await syncConnection(connectionId);
    await setCategory(PENDING_ID, "outros", "user");
    fixtures.cardTransactions = fixtures.cardTransactions.map((t) =>
      t.id === PENDING_ID ? { ...t, description: "DROGASIL 123" } : t,
    );

    await syncConnection(connectionId);

    expect(await categoryOf(PENDING_ID)).toMatchObject({ category: "outros", source: "user" });
  });
});
