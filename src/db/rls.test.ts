import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
  budgetGoals,
  categories,
  categoryRules,
  changeLog,
  creditCardBills,
  financialAccounts,
  householdInvites,
  householdMembers,
  householdMemberships,
  householdSharedAccounts,
  households,
  integrationConnections,
  pluggyCredentials,
  pushSubscriptions,
  transactions,
  webhookEvents,
} from "@/db/schema";
import { createTestDatabase, seedHousehold } from "@/test/database";

type TestDb = Awaited<ReturnType<typeof createTestDatabase>>;
type Tx = Parameters<Parameters<TestDb["transaction"]>[0]>[0];

let db: TestDb;
let lucas: string;
let karina: string;
let ana: string;
let casa: string;
let outra: string;
let lucasShared: string;
let lucasPrivate: string;
let anaAccount: string;
let anaConnectionId: string;
let sharedTransaction: string;
let privateTransaction: string;
let anaTransaction: string;
let category: string;

function as<T>(memberId: string | null, work: (tx: Tx) => Promise<T>) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('role', 'authenticated', true), set_config('app.member_id', ${memberId ?? ""}, true)`);
    return work(tx);
  });
}

async function account(connectionId: string, externalId: string) {
  const [row] = await db
    .insert(financialAccounts)
    .values({ connectionId, externalId, kind: "checking", name: externalId, currency: "BRL", balanceCents: 0 })
    .returning({ id: financialAccounts.id });
  return row.id;
}

async function transaction(accountId: string, externalId: string) {
  const [row] = await db
    .insert(transactions)
    .values({
      accountId,
      externalId,
      occurredAt: new Date("2026-11-10T12:00:00Z"),
      description: externalId,
      amountCents: 1000,
      direction: "outflow",
      status: "posted",
      currency: "BRL",
    })
    .returning({ id: transactions.id });
  return row.id;
}

beforeAll(async () => {
  db = await createTestDatabase();
  const first = await seedHousehold(db);
  const second = await seedHousehold(db);
  lucas = first.lucas.id;
  karina = first.karina.id;
  ana = second.lucas.id;
  casa = first.household.id;
  outra = second.household.id;
  category = (await db.select().from(categories).limit(1))[0].id;

  const [lucasConnection] = await db.insert(integrationConnections).values({ memberId: lucas, externalItemId: "item-lucas" }).returning();
  const [anaConnection] = await db.insert(integrationConnections).values({ memberId: ana, externalItemId: "item-ana" }).returning();
  anaConnectionId = anaConnection.id;
  lucasShared = await account(lucasConnection.id, "compartilhada");
  lucasPrivate = await account(lucasConnection.id, "privada");
  anaAccount = await account(anaConnection.id, "da-ana");
  await db.insert(householdSharedAccounts).values({ householdId: casa, accountId: lucasShared, sharedByMemberId: lucas });
  sharedTransaction = await transaction(lucasShared, "t-compartilhada");
  privateTransaction = await transaction(lucasPrivate, "t-privada");
  anaTransaction = await transaction(anaAccount, "t-ana");
  await db.insert(creditCardBills).values({ accountId: lucasShared, externalId: "f1", dueDate: "2026-12-10", totalCents: 100, currency: "BRL" });
  await db.insert(pluggyCredentials).values({ memberId: lucas, clientId: "id", clientSecretEncrypted: "segredo" });
  await db.insert(pushSubscriptions).values({ memberId: lucas, endpoint: "https://push/lucas", p256dh: "k", auth: "a" });
  await db.insert(categoryRules).values({ ownerMemberId: lucas, merchantName: "LOJA", categoryId: category });
  await db.insert(categoryRules).values({ householdId: casa, merchantName: "MERCADO", categoryId: category });
  await db.insert(budgetGoals).values({ householdId: casa, limitCents: 1000, startsMonth: "2026-11", categoryId: category });
  await db.insert(changeLog).values({ householdId: casa, memberId: lucas, kind: "rule_saved", subject: "LOJA" });
  await db.insert(householdInvites).values({ householdId: casa, tokenHash: "hash", createdByMemberId: lucas, expiresAt: new Date("2030-01-01") });
  await db.insert(webhookEvents).values({ provider: "pluggy", externalEventId: "e1", event: "item/updated", receivedAt: new Date() });
});

const count = (tx: Tx, table: Parameters<Tx["$count"]>[0]) => tx.$count(table);

describe("quem é de fora não enxerga nada", () => {
  it.each([
    ["transactions", transactions],
    ["financial_accounts", financialAccounts],
    ["credit_card_bills", creditCardBills],
    ["integration_connections", integrationConnections],
    ["pluggy_credentials", pluggyCredentials],
    ["push_subscriptions", pushSubscriptions],
    ["category_rules", categoryRules],
    ["budget_goals", budgetGoals],
    ["change_log", changeLog],
    ["household_invites", householdInvites],
    ["household_shared_accounts", householdSharedAccounts],
  ])("%s", async (_name, table) => {
    const stranger = (await seedHousehold(db)).lucas.id;
    expect(await as(stranger, (tx) => count(tx, table))).toBe(0);
  });

  it("sem identidade a requisição não enxerga nada, nem as categorias comuns saem sem papel", async () => {
    expect(await as(null, (tx) => count(tx, transactions))).toBe(0);
    expect(await as(null, (tx) => count(tx, households))).toBe(0);
    expect(await as(null, (tx) => count(tx, householdMembers))).toBe(0);
  });

  it("eventos de webhook não são de ninguém", async () => {
    expect(await as(lucas, (tx) => count(tx, webhookEvents))).toBe(0);
    await expect(
      as(lucas, (tx) => tx.insert(webhookEvents).values({ provider: "pluggy", externalEventId: "e2", event: "x", receivedAt: new Date() })),
    ).rejects.toThrow();
  });

  it("outra residência não aparece nem para quem pertence a uma", async () => {
    expect((await as(ana, (tx) => tx.select({ id: households.id }).from(households))).map((row) => row.id)).toEqual([outra]);
    expect(await as(ana, (tx) => count(tx, householdMembers))).toBe(2);
  });
});

describe("contas e transações", () => {
  it("o titular enxerga tudo que é dele", async () => {
    expect(await as(lucas, (tx) => count(tx, financialAccounts))).toBe(2);
    expect(await as(lucas, (tx) => count(tx, transactions))).toBe(2);
  });

  it("quem divide a residência só enxerga o que foi compartilhado", async () => {
    const accounts = await as(karina, (tx) => tx.select({ id: financialAccounts.id }).from(financialAccounts));
    expect(accounts.map((row) => row.id)).toEqual([lucasShared]);
    const rows = await as(karina, (tx) => tx.select({ id: transactions.id }).from(transactions));
    expect(rows.map((row) => row.id)).toEqual([sharedTransaction]);
    expect(await as(karina, (tx) => tx.$count(transactions, eq(transactions.id, privateTransaction)))).toBe(0);
    expect(await as(karina, (tx) => tx.$count(transactions, eq(transactions.id, anaTransaction)))).toBe(0);
  });

  it("não vê credenciais nem inscrições do colega, e a conexão só enquanto há conta compartilhada", async () => {
    expect(await as(karina, (tx) => count(tx, pluggyCredentials))).toBe(0);
    expect(await as(karina, (tx) => count(tx, pushSubscriptions))).toBe(0);
    expect(await as(karina, (tx) => count(tx, integrationConnections))).toBe(1);
    await as(karina, (tx) => tx.update(integrationConnections).set({ status: "revoked" }));
    await as(karina, (tx) => tx.delete(integrationConnections));
    expect(await db.$count(integrationConnections, eq(integrationConnections.status, "active"))).toBe(2);
    expect(await db.$count(integrationConnections)).toBe(2);
  });

  it("quem só enxerga a conta ajusta a transação, mas não cria, apaga nem mexe na conta", async () => {
    await as(karina, (tx) => tx.update(transactions).set({ expenseNature: "shared" }).where(eq(transactions.id, sharedTransaction)));
    expect((await db.select().from(transactions).where(eq(transactions.id, sharedTransaction)))[0].expenseNature).toBe("shared");

    await expect(as(karina, (tx) => insertForged(tx, lucasShared))).rejects.toThrow();
    await as(karina, (tx) => tx.delete(transactions).where(eq(transactions.id, sharedTransaction)));
    expect(await db.$count(transactions, eq(transactions.id, sharedTransaction))).toBe(1);
    await as(karina, (tx) => tx.update(financialAccounts).set({ name: "invadida" }).where(eq(financialAccounts.id, lucasShared)));
    expect((await db.select().from(financialAccounts).where(eq(financialAccounts.id, lucasShared)))[0].name).toBe("compartilhada");
    await as(karina, (tx) => tx.update(creditCardBills).set({ totalCents: 1 }).where(eq(creditCardBills.accountId, lucasShared)));
    expect((await db.select().from(creditCardBills))[0].totalCents).toBe(100);
  });

  it("não altera transação de conta privada nem de outra pessoa", async () => {
    await as(karina, (tx) => tx.update(transactions).set({ description: "invadida" }).where(eq(transactions.id, privateTransaction)));
    await as(lucas, (tx) => tx.update(transactions).set({ description: "invadida" }).where(eq(transactions.id, anaTransaction)));
    const descriptions = await db.select({ description: transactions.description }).from(transactions);
    expect(descriptions.map((row) => row.description)).not.toContain("invadida");
  });

  it("não cria conta nem conexão em nome de outra pessoa", async () => {
    await expect(as(karina, (tx) => tx.insert(integrationConnections).values({ memberId: lucas, externalItemId: "forjada" }))).rejects.toThrow();
    await expect(
      as(karina, (tx) =>
        tx.insert(financialAccounts).values({ connectionId: anaConnectionId, externalId: "x", kind: "checking", name: "x", currency: "BRL", balanceCents: 0 }),
      ),
    ).rejects.toThrow();
  });
});

describe("compartilhamento", () => {
  it("só o titular compartilha a própria conta, e só com residência da qual participa", async () => {
    await expect(
      as(karina, (tx) => tx.insert(householdSharedAccounts).values({ householdId: casa, accountId: lucasPrivate, sharedByMemberId: karina })),
    ).rejects.toThrow();
    await expect(
      as(lucas, (tx) => tx.insert(householdSharedAccounts).values({ householdId: outra, accountId: lucasPrivate, sharedByMemberId: lucas })),
    ).rejects.toThrow();
    await expect(
      as(lucas, (tx) => tx.insert(householdSharedAccounts).values({ householdId: casa, accountId: lucasPrivate, sharedByMemberId: karina })),
    ).rejects.toThrow();
  });

  it("quem não é titular nem administrador não desfaz o compartilhamento", async () => {
    await as(karina, (tx) => tx.delete(householdSharedAccounts).where(eq(householdSharedAccounts.accountId, lucasShared)));
    expect(await db.$count(householdSharedAccounts)).toBe(1);
  });
});

describe("residências, integrantes e convites", () => {
  it("quem não administra não muda o nome, os papéis nem remove outros", async () => {
    await as(karina, (tx) => tx.update(households).set({ name: "invadida" }).where(eq(households.id, casa)));
    await as(karina, (tx) => tx.update(householdMemberships).set({ role: "admin" }).where(eq(householdMemberships.memberId, karina)));
    await as(karina, (tx) => tx.delete(householdMemberships).where(eq(householdMemberships.memberId, lucas)));
    expect((await db.select().from(households).where(eq(households.id, casa)))[0].name).not.toBe("invadida");
    expect((await db.select().from(householdMemberships).where(eq(householdMemberships.memberId, karina)))[0].role).toBe("member");
    expect(await db.$count(householdMemberships, eq(householdMemberships.memberId, lucas))).toBe(1);
  });

  it("ninguém se coloca numa residência por conta própria", async () => {
    await expect(as(karina, (tx) => tx.insert(householdMemberships).values({ householdId: outra, memberId: karina }))).rejects.toThrow();
    await expect(as(ana, (tx) => tx.insert(householdMemberships).values({ householdId: casa, memberId: ana }))).rejects.toThrow();
    await expect(as(ana, (tx) => tx.insert(households).values({ name: "criada por fora" }))).rejects.toThrow();
  });

  it("convites: só o administrador cria, e só o das próprias residências", async () => {
    const invite = (householdId: string, createdByMemberId: string) =>
      (tx: Tx) => tx.insert(householdInvites).values({ householdId, tokenHash: `h-${Math.random()}`, createdByMemberId, expiresAt: new Date("2030-01-01") });
    await expect(as(karina, invite(casa, karina))).rejects.toThrow();
    await expect(as(lucas, invite(outra, lucas))).rejects.toThrow();
    await as(lucas, invite(casa, lucas));
  });

  it("o administrador remove integrantes da própria residência", async () => {
    const [{ id }] = await db.insert(householdMemberships).values({ householdId: casa, memberId: ana }).returning({ id: householdMemberships.id });
    await as(lucas, (tx) => tx.delete(householdMemberships).where(eq(householdMemberships.id, id)));
    expect(await db.$count(householdMemberships, eq(householdMemberships.id, id))).toBe(0);
  });

  it("cada um só edita o próprio perfil", async () => {
    await as(karina, (tx) => tx.update(householdMembers).set({ displayName: "invadida" }).where(eq(householdMembers.id, lucas)));
    expect((await db.select().from(householdMembers).where(eq(householdMembers.id, lucas)))[0].displayName).not.toBe("invadida");
    await as(karina, (tx) => tx.update(householdMembers).set({ displayName: "Karina nova" }).where(eq(householdMembers.id, karina)));
    expect((await db.select().from(householdMembers).where(eq(householdMembers.id, karina)))[0].displayName).toBe("Karina nova");
  });
});

describe("metas, regras e histórico", () => {
  it("integrantes enxergam o que é da residência e só dela", async () => {
    expect(await as(karina, (tx) => count(tx, budgetGoals))).toBe(1);
    expect(await as(karina, (tx) => tx.$count(categoryRules, eq(categoryRules.householdId, casa)))).toBe(1);
    expect(await as(karina, (tx) => count(tx, changeLog))).toBe(1);
  });

  it("a regra pessoal é só do dono", async () => {
    const rules = await as(karina, (tx) => tx.select({ owner: categoryRules.ownerMemberId }).from(categoryRules));
    expect(rules.every((rule) => rule.owner === null)).toBe(true);
    await expect(
      as(karina, (tx) => tx.insert(categoryRules).values({ ownerMemberId: lucas, merchantName: "FORJADA", categoryId: category })),
    ).rejects.toThrow();
  });

  it("não cria meta nem regra em residência alheia", async () => {
    await expect(as(ana, (tx) => tx.insert(budgetGoals).values({ householdId: casa, limitCents: 1, startsMonth: "2026-11" }))).rejects.toThrow();
    await expect(as(ana, (tx) => tx.insert(categoryRules).values({ householdId: casa, merchantName: "X", categoryId: category }))).rejects.toThrow();
  });

  it("o histórico só aceita registros próprios e da própria residência", async () => {
    await expect(as(ana, (tx) => tx.insert(changeLog).values({ householdId: casa, memberId: ana, kind: "rule_saved", subject: "x" }))).rejects.toThrow();
    await expect(as(karina, (tx) => tx.insert(changeLog).values({ householdId: casa, memberId: lucas, kind: "rule_saved", subject: "x" }))).rejects.toThrow();
    await as(karina, (tx) => tx.insert(changeLog).values({ householdId: casa, memberId: karina, kind: "rule_saved", subject: "ok" }));
  });

  it("o catálogo de categorias é leitura para todos", async () => {
    expect(await as(karina, (tx) => count(tx, categories))).toBeGreaterThan(0);
    await expect(as(karina, (tx) => tx.insert(categories).values({ slug: "x", name: "X", sortOrder: 999 }))).rejects.toThrow();
  });
});

function insertForged(tx: Tx, accountId: string) {
  return tx.insert(transactions).values({
    accountId,
    externalId: "forjada",
    occurredAt: new Date(),
    description: "forjada",
    amountCents: 1,
    direction: "outflow",
    status: "posted",
    currency: "BRL",
  });
}
