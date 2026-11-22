import { beforeEach, describe, expect, it, vi } from "vitest";
import { categories, financialAccounts, integrationConnections, transactions } from "@/db/schema";
import { createTestDatabase, seedHousehold } from "@/test/database";

const state = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("@/db/client", () => ({ getDb: () => state.db }));

const { correctCategory } = await import("./categorization");
const { correctExpenseNature } = await import("./expense-nature");
const { listGoals, removeGoal, saveGoal } = await import("./budget");
const { listChanges } = await import("./change-log");

type TestDb = Awaited<ReturnType<typeof createTestDatabase>>;
const db = () => state.db as TestDb;

const NOW = new Date("2026-11-20T15:00:00-03:00");
const DECEMBER = new Date("2026-12-05T15:00:00-03:00");

let lucas: { memberId: string; householdId: string };
let karinaId: string;
let outra: { memberId: string; householdId: string };
let category: Record<string, string>;
let sequence = 0;

async function newAccount(memberId: string) {
  sequence += 1;
  const [connection] = await db()
    .insert(integrationConnections)
    .values({ memberId, externalItemId: `item-${sequence}`, institutionName: "Banco" })
    .returning();
  const [account] = await db()
    .insert(financialAccounts)
    .values({ connectionId: connection.id, externalId: `conta-${sequence}`, kind: "credit_card", name: "Cartão", currency: "BRL", balanceCents: 0 })
    .returning();
  return account.id;
}

async function purchase(accountId: string, merchant: string, slug: string | null) {
  sequence += 1;
  const [row] = await db()
    .insert(transactions)
    .values({
      accountId,
      externalId: `t${sequence}`,
      occurredAt: new Date("2026-11-10T12:00:00-03:00"),
      description: merchant,
      merchantName: merchant,
      amountCents: 5000,
      direction: "outflow",
      status: "posted",
      currency: "BRL",
      categoryId: slug ? category[slug] : null,
      categorySource: slug ? "automatic" : null,
    })
    .returning();
  return row.id;
}

beforeEach(async () => {
  state.db = await createTestDatabase();
  category = Object.fromEntries((await db().select().from(categories)).map((c) => [c.slug, c.id]));
  const seeded = await seedHousehold(db());
  lucas = { memberId: seeded.lucas.id, householdId: seeded.household.id };
  karinaId = seeded.karina.id;
  const other = await seedHousehold(db());
  outra = { memberId: other.lucas.id, householdId: other.household.id };
});

describe("histórico de classificação", () => {
  it("registra a categoria anterior e a nova numa correção só da transação", async () => {
    const account = await newAccount(lucas.memberId);
    const id = await purchase(account, "SONDA", "supermercado");

    await correctCategory(lucas, id, category.restaurantes, "transaction");

    const [entry] = await listChanges(lucas.householdId);
    expect(entry).toMatchObject({
      kind: "category_changed",
      subject: "SONDA",
      scope: "transaction",
      previousValue: "Supermercado",
      newValue: "Restaurantes e delivery",
      affectedCount: 1,
      memberName: "Lucas",
    });
  });

  it("usa Sem categoria quando não havia categoria", async () => {
    const account = await newAccount(lucas.memberId);
    const id = await purchase(account, "LOJA X", null);

    await correctCategory(lucas, id, category.restaurantes, "merchant");

    const [entry] = await listChanges(lucas.householdId);
    expect(entry).toMatchObject({ previousValue: "Sem categoria", scope: "merchant", affectedCount: 1 });
  });

  it("conta as transações do histórico afetadas pela regra", async () => {
    const account = await newAccount(lucas.memberId);
    const id = await purchase(account, "SONDA", "supermercado");
    await purchase(account, "SONDA", "supermercado");
    await purchase(account, "SONDA", "supermercado");

    await correctCategory(lucas, id, category.restaurantes, "merchant_history");

    const [entry] = await listChanges(lucas.householdId);
    expect(entry).toMatchObject({ scope: "merchant_history", affectedCount: 3 });
  });

  it("registra para quem anterior e novo", async () => {
    const account = await newAccount(lucas.memberId);
    const id = await purchase(account, "SMART FIT", "saude");

    await correctExpenseNature(lucas, id, karinaId, "transaction");
    await correctExpenseNature(lucas, id, "shared", "transaction");

    const entries = await listChanges(lucas.householdId);
    expect(entries.map((e) => [e.kind, e.previousValue, e.newValue])).toEqual([
      ["expense_changed", "Karina", "Compartilhado"],
      ["expense_changed", "Sem definição", "Karina"],
    ]);
  });

  it("não registra nada quando a correção é recusada", async () => {
    const account = await newAccount(lucas.memberId);
    const id = await purchase(account, "SONDA", "supermercado");

    const result = await correctCategory(lucas, id, "não-é-uuid", "transaction");

    expect(result.ok).toBe(false);
    expect(await listChanges(lucas.householdId)).toEqual([]);
  });

  it("não deixa uma residência ver nem alterar o histórico de outra", async () => {
    const account = await newAccount(lucas.memberId);
    const id = await purchase(account, "SONDA", "supermercado");

    const result = await correctCategory(outra, id, category.restaurantes, "transaction");

    expect(result.ok).toBe(false);
    expect(await listChanges(outra.householdId)).toEqual([]);
    expect(await listChanges(lucas.householdId)).toEqual([]);
  });
});

describe("histórico de metas", () => {
  const input = { categoryId: "", expense: "", limit: "500", thresholds: "70, 90, 100" };

  it("registra criação, alteração e remoção, com o valor anterior", async () => {
    await saveGoal(lucas, { ...input, categoryId: category.restaurantes }, NOW);
    const [goal] = await listGoals(lucas.householdId);
    await saveGoal(lucas, { ...input, categoryId: category.restaurantes, goalId: goal.id, limit: "650", thresholds: "80, 100" }, NOW);
    await removeGoal(lucas, goal.id, NOW);

    const entries = await listChanges(lucas.householdId);
    expect(entries.map((e) => e.kind)).toEqual(["goal_removed", "goal_updated", "goal_created"]);
    const clean = (text: string | null) => text?.replace(/ /g, " ");
    expect(clean(entries[2].newValue)).toBe("Restaurantes e delivery: R$ 500,00 por mês · avisos em 70%, 90%, 100%");
    expect(clean(entries[1].previousValue)).toBe("Restaurantes e delivery: R$ 500,00 por mês · avisos em 70%, 90%, 100%");
    expect(clean(entries[1].newValue)).toBe("Restaurantes e delivery: R$ 650,00 por mês · avisos em 80%, 100%");
    expect(clean(entries[0].previousValue)).toBe("Restaurantes e delivery: R$ 650,00 por mês · avisos em 80%, 100%");
    expect(entries[0].newValue).toBeNull();
  });

  it("registra o encerramento de uma meta criada em mês anterior", async () => {
    await saveGoal(lucas, input, NOW);
    const [goal] = await listGoals(lucas.householdId);

    await removeGoal(lucas, goal.id, DECEMBER);

    const [entry] = await listChanges(lucas.householdId);
    expect(entry).toMatchObject({ kind: "goal_removed", subject: "Todo o consumo" });
  });

  it("não registra quando a meta é recusada e filtra por tipo", async () => {
    await saveGoal(lucas, { ...input, limit: "abc" }, NOW);
    expect(await listChanges(lucas.householdId)).toEqual([]);

    await saveGoal(lucas, input, NOW);
    const account = await newAccount(lucas.memberId);
    await correctCategory(lucas, await purchase(account, "SONDA", "supermercado"), category.restaurantes, "transaction");

    expect((await listChanges(lucas.householdId, "metas")).map((e) => e.kind)).toEqual(["goal_created"]);
    expect((await listChanges(lucas.householdId, "classificacao")).map((e) => e.kind)).toEqual(["category_changed"]);
    expect(await listChanges(lucas.householdId)).toHaveLength(2);
  });
});
