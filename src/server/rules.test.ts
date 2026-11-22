import { beforeEach, describe, expect, it, vi } from "vitest";
import { categories, categoryRules, expenseNatureRules, financialAccounts, integrationConnections, transactions } from "@/db/schema";
import { householdScope } from "@/domain/scope";
import { createTestDatabase, seedHousehold, shareWithMemberHousehold } from "@/test/database";

const state = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("@/db/client", () => ({ getDb: () => state.db, getServiceDb: () => state.db, asService: <T>(work: () => Promise<T>) => work() }));

const { deleteCategoryRule, deleteNatureRule, listKnownMerchants, listRules, saveCategoryRule, saveNatureRule } = await import("./rules");
const { listChanges } = await import("./change-log");

type TestDb = Awaited<ReturnType<typeof createTestDatabase>>;
const db = () => state.db as TestDb;

let lucas: { id: string };
let karina: { id: string };
let householdId: string;
let accountId: string;
let category: Record<string, string>;
let sequence = 0;

async function purchase(merchant: string, extra: Record<string, unknown> = {}) {
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
      ...extra,
    })
    .returning();
  return row.id;
}

const read = async (id: string) => (await db().select().from(transactions).where((await import("drizzle-orm")).eq(transactions.id, id)))[0];

beforeEach(async () => {
  state.db = await createTestDatabase();
  const seeded = await seedHousehold(db());
  lucas = seeded.lucas;
  karina = seeded.karina;
  householdId = seeded.household.id;
  const [connection] = await db().insert(integrationConnections).values({ memberId: lucas.id, externalItemId: "item", institutionName: "Banco" }).returning();
  const [account] = await db()
    .insert(financialAccounts)
    .values({ connectionId: connection.id, externalId: "conta", kind: "checking", name: "Conta", currency: "BRL", balanceCents: 0 })
    .returning();
  accountId = account.id;
  await shareWithMemberHousehold(db(), accountId, lucas.id);
  category = Object.fromEntries((await db().select().from(categories)).map((c) => [c.slug, c.id]));
});

describe("regras de categoria", () => {
  it("cria a regra e aplica ao histórico sem tocar no que foi ajustado à mão", async () => {
    const automatic = await purchase("PADARIA CENTRAL", { categoryId: category.restaurantes, categorySource: "automatic" });
    const manual = await purchase("PADARIA CENTRAL", { categoryId: category.transporte, categorySource: "user" });

    const result = await saveCategoryRule(karina.id, householdId, "  PADARIA   CENTRAL ", category.supermercado, true);

    expect(result).toMatchObject({ ok: true });
    expect(await db().$count(categoryRules)).toBe(1);
    expect(await read(automatic)).toMatchObject({ categoryId: category.supermercado, categorySource: "rule" });
    expect(await read(manual)).toMatchObject({ categoryId: category.transporte, categorySource: "user" });
  });

  it("sem aplicar ao histórico, só vale daqui para frente", async () => {
    const before = await purchase("PADARIA CENTRAL", { categoryId: category.restaurantes, categorySource: "automatic" });
    await saveCategoryRule(lucas.id, householdId, "PADARIA CENTRAL", category.supermercado, false);
    expect(await read(before)).toMatchObject({ categoryId: category.restaurantes });
    expect(await db().$count(categoryRules)).toBe(1);
  });

  it("salvar de novo troca a categoria da mesma regra", async () => {
    await saveCategoryRule(lucas.id, householdId, "LOJA", category.supermercado, false);
    await saveCategoryRule(lucas.id, householdId, "LOJA", category.restaurantes, false);
    const rules = (await listRules(lucas.id, householdId)).category;
    expect(rules.map((r) => [r.merchantName, r.categoryId])).toEqual([["LOJA", category.restaurantes]]);
  });

  it("remover mantém as transações já classificadas", async () => {
    const id = await purchase("LOJA");
    await saveCategoryRule(lucas.id, householdId, "LOJA", category.supermercado, true);
    const [rule] = await db().select().from(categoryRules);

    expect(await deleteCategoryRule(karina.id, rule.id)).toMatchObject({ ok: true });

    expect(await db().$count(categoryRules)).toBe(0);
    expect(await read(id)).toMatchObject({ categoryId: category.supermercado });
  });

  it("valida estabelecimento, categoria e participação na residência", async () => {
    const outra = await seedHousehold(db());
    expect(await saveCategoryRule(lucas.id, householdId, "  ", category.supermercado, true)).toMatchObject({ ok: false });
    expect(await saveCategoryRule(lucas.id, householdId, "LOJA", "nao-uuid", true)).toMatchObject({ ok: false });
    expect(await saveCategoryRule(lucas.id, outra.household.id, "LOJA", category.supermercado, true)).toMatchObject({ ok: false });
    expect(await db().$count(categoryRules)).toBe(0);
    await saveCategoryRule(lucas.id, householdId, "LOJA", category.supermercado, false);
    const [rule] = await db().select().from(categoryRules);
    expect(await deleteCategoryRule(outra.lucas.id, rule.id)).toMatchObject({ ok: false });
  });

  it("registra a criação e a remoção no histórico", async () => {
    await saveCategoryRule(lucas.id, householdId, "LOJA", category.supermercado, false);
    const [rule] = await db().select().from(categoryRules);
    await deleteCategoryRule(lucas.id, rule.id);
    expect((await listChanges(householdId, "regras")).map((c) => c.kind).sort()).toEqual(["rule_removed", "rule_saved"]);
  });
});

describe("regras de para quem", () => {
  it("define para a Casa, para o compartilhado ou para uma pessoa", async () => {
    const id = await purchase("CONDOMINIO");
    expect(await saveNatureRule(lucas.id, householdId, "CONDOMINIO", "household", true)).toMatchObject({ ok: true });
    expect(await read(id)).toMatchObject({ expenseNature: "household", expenseNatureSource: "rule" });

    await saveNatureRule(lucas.id, householdId, "CONDOMINIO", karina.id, true);
    expect(await read(id)).toMatchObject({ expenseNature: "individual", expenseMemberId: karina.id });
    expect((await listRules(lucas.id, householdId)).nature.map((r) => r.label)).toEqual(["Karina"]);
  });

  it("recusa escolha inválida e pessoa de fora", async () => {
    expect(await saveNatureRule(lucas.id, householdId, "LOJA", "", true)).toMatchObject({ ok: false });
    expect(await saveNatureRule(lucas.id, householdId, "LOJA", "11111111-1111-4111-8111-111111111111", true)).toMatchObject({ ok: false });
    expect(await db().$count(expenseNatureRules)).toBe(0);
  });

  it("remover devolve à classificação automática o que não foi ajustado à mão", async () => {
    const id = await purchase("CONDOMINIO");
    const manual = await purchase("CONDOMINIO", { expenseNature: "shared", expenseNatureSource: "user" });
    await saveNatureRule(lucas.id, householdId, "CONDOMINIO", karina.id, true);
    const [rule] = await db().select().from(expenseNatureRules);

    await deleteNatureRule(lucas.id, rule.id);

    expect(await read(id)).toMatchObject({ expenseNatureSource: "automatic", expenseMemberId: null });
    expect(await read(manual)).toMatchObject({ expenseNature: "shared", expenseNatureSource: "user" });
  });
});

describe("regras pessoais de categoria", () => {
  it("funcionam sem residência e só atingem as contas do dono", async () => {
    const mine = await purchase("LOJA");
    const [otherConnection] = await db().insert(integrationConnections).values({ memberId: karina.id, externalItemId: "item2", institutionName: "Banco 2" }).returning();
    const [otherAccount] = await db()
      .insert(financialAccounts)
      .values({ connectionId: otherConnection.id, externalId: "conta2", kind: "checking", name: "Conta 2", currency: "BRL", balanceCents: 0 })
      .returning();
    const [theirs] = await db()
      .insert(transactions)
      .values({ accountId: otherAccount.id, externalId: "x1", occurredAt: new Date(), description: "LOJA", merchantName: "LOJA", amountCents: 100, direction: "outflow", status: "posted", currency: "BRL" })
      .returning();

    expect(await saveCategoryRule(lucas.id, null, "LOJA", category.supermercado, true)).toMatchObject({ ok: true });

    expect(await db().$count(categoryRules)).toBe(1);
    expect(await read(mine)).toMatchObject({ categoryId: category.supermercado, categorySource: "rule" });
    expect((await db().select().from(transactions).where((await import("drizzle-orm")).eq(transactions.id, theirs.id)))[0]).toMatchObject({ categoryId: null });
    expect((await listRules(lucas.id, null)).personal.map((r) => r.merchantName)).toEqual(["LOJA"]);
    expect(await db().$count((await import("@/db/schema")).changeLog)).toBe(0);
  });

  it("a regra da residência não sobrescreve quem tem regra própria", async () => {
    const id = await purchase("LOJA");
    await saveCategoryRule(lucas.id, null, "LOJA", category.restaurantes, true);
    await saveCategoryRule(karina.id, householdId, "LOJA", category.supermercado, true);

    expect(await read(id)).toMatchObject({ categoryId: category.restaurantes });
  });

  it("só o dono remove a regra pessoal", async () => {
    await saveCategoryRule(lucas.id, null, "LOJA", category.supermercado, false);
    const [rule] = await db().select().from(categoryRules);

    expect(await deleteCategoryRule(karina.id, rule.id)).toMatchObject({ ok: false });
    expect(await deleteCategoryRule(lucas.id, rule.id)).toMatchObject({ ok: true });
  });
});

describe("estabelecimentos conhecidos", () => {
  it("lista os mais frequentes das contas da residência", async () => {
    await purchase("PADARIA");
    await purchase("PADARIA");
    await purchase("MERCADO");
    const outra = await seedHousehold(db());
    expect(await listKnownMerchants(householdScope(householdId))).toEqual(["PADARIA", "MERCADO"]);
    expect(await listKnownMerchants(householdScope(outra.household.id))).toEqual([]);
  });
});
