import { randomBytes } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
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
const { latestSyncRuns, syncConnection } = await import("./sync");
const { listHouseholdAccounts } = await import("./accounts");

type TestDb = Awaited<ReturnType<typeof createTestDatabase>>;
const db = () => state.db as TestDb;

const ITEM_ID = "2eaac5ff-57cb-49bd-b51e-cd6f39ba56d3";
const CARD_ID = "f9dd22a9-84dd-470d-8d0e-63a02537d5bc";
const NOVEMBER_BILL = "0c15574b-9488-4556-a388-d3891cd01bfd";
const PENDING_ID = "aa11aa11-0000-4000-8000-000000000001";

type Fixtures = {
  cardTransactions: typeof cardTransactionsFixture.results;
  bills: typeof billsFixture.results;
  authStatus: number;
  accountsStatus: number;
};

let fixtures: Fixtures;
let connectionId: string;
let householdId: string;

function simulatePluggy() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      const url = new URL(input);
      const json = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status });
      if (url.pathname === "/auth") {
        return fixtures.authStatus === 200 ? json(200, { apiKey: "chave" }) : json(fixtures.authStatus);
      }
      if (url.pathname === "/accounts") {
        return fixtures.accountsStatus === 200 ? json(200, accountsFixture) : json(fixtures.accountsStatus);
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
  const { household, lucas } = await seedHousehold(db());
  householdId = household.id;
  await db()
    .insert(pluggyCredentials)
    .values({ memberId: lucas.id, clientId: "593ce5a5-bd0f-47d1-af52-50d0acb74bee", clientSecretEncrypted: encrypt("segredo") });
  const [connection] = await db()
    .insert(integrationConnections)
    .values({ memberId: lucas.id, externalItemId: ITEM_ID, institutionName: "Santander" })
    .returning();
  connectionId = connection.id;
  fixtures = {
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

    expect(result).toEqual({ ok: true, accounts: 2, bills: 2, transactions: 10 });
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

    expect(second.ok).toBe(true);
    expect(await counts()).toEqual({ accounts: 2, bills: 2, transactions: 10 });
  });

  it("atualiza transação existente quando a fonte muda", async () => {
    await syncConnection(connectionId);
    fixtures.cardTransactions = fixtures.cardTransactions.map((t) =>
      t.id === PENDING_ID ? { ...t, status: "POSTED", amount: 7.5 } : t,
    );

    await syncConnection(connectionId);

    const [updated] = await db().select().from(transactions).where(eq(transactions.externalId, PENDING_ID));
    expect(updated).toMatchObject({ status: "posted", amountCents: 750 });
  });

  it("remove transação pendente que a fonte deixou de enviar", async () => {
    await syncConnection(connectionId);
    fixtures.cardTransactions = fixtures.cardTransactions.filter((t) => t.id !== PENDING_ID);

    await syncConnection(connectionId);

    expect(await db().$count(transactions, eq(transactions.externalId, PENDING_ID))).toBe(0);
    expect(await db().$count(transactions)).toBe(9);
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
    expect(run).toMatchObject({ status: "succeeded", accountsCount: 2, billsCount: 2, transactionsCount: 10, error: null });
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
