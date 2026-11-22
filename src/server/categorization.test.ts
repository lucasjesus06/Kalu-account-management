import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  categories,
  categoryRules,
  financialAccounts,
  integrationConnections,
  transactions,
} from "@/db/schema";
import { createTestDatabase, seedHousehold, shareWithMemberHousehold } from "@/test/database";

const state = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("@/db/client", () => ({ getDb: () => state.db }));

const { correctCategory, listCategories } = await import("./categorization");

type TestDb = Awaited<ReturnType<typeof createTestDatabase>>;
const db = () => state.db as TestDb;

let lucas: { memberId: string; householdId: string };
let ids: Record<string, string>;
let category: Record<string, string>;

async function insertTransaction(accountId: string, externalId: string, merchantName: string, source: "automatic" | "user" | null, slug: string | null) {
  const [row] = await db()
    .insert(transactions)
    .values({
      accountId,
      externalId,
      occurredAt: new Date("2026-11-10T12:00:00Z"),
      description: merchantName,
      merchantName,
      amountCents: 1000,
      direction: "outflow",
      status: "posted",
      currency: "BRL",
      categoryId: slug ? category[slug] : null,
      categorySource: source,
    })
    .returning();
  return row.id;
}

async function accountFor(memberId: string, externalId: string) {
  const [connection] = await db()
    .insert(integrationConnections)
    .values({ memberId, externalItemId: `item-${externalId}`, institutionName: "Banco" })
    .returning();
  const [account] = await db()
    .insert(financialAccounts)
    .values({ connectionId: connection.id, externalId, kind: "credit_card", name: "Cartão", currency: "BRL", balanceCents: 0 })
    .returning();
  await shareWithMemberHousehold(db(), account.id, memberId);
  return account.id;
}

async function row(id: string) {
  const [result] = await db()
    .select({ category: categories.slug, source: transactions.categorySource })
    .from(transactions)
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .where(eq(transactions.id, id));
  return result;
}

beforeEach(async () => {
  state.db = await createTestDatabase();
  category = Object.fromEntries((await db().select().from(categories)).map((c) => [c.slug, c.id]));
  const seeded = await seedHousehold(db());
  lucas = { memberId: seeded.lucas.id, householdId: seeded.household.id };
  const lucasCard = await accountFor(seeded.lucas.id, "cartao-lucas");
  const karinaCard = await accountFor(seeded.karina.id, "cartao-karina");
  const outra = await seedHousehold(db());
  const outraCard = await accountFor(outra.lucas.id, "cartao-outra");
  ids = {
    alvo: await insertTransaction(lucasCard, "t1", "PADARIA DO ZE", "automatic", "outros"),
    anterior: await insertTransaction(lucasCard, "t2", "PADARIA DO ZE", "automatic", "outros"),
    daKarina: await insertTransaction(karinaCard, "t3", "PADARIA DO ZE", null, null),
    excecao: await insertTransaction(lucasCard, "t4", "PADARIA DO ZE", "user", "restaurantes"),
    outroEstabelecimento: await insertTransaction(lucasCard, "t5", "LOJA", "automatic", "outros"),
    outraResidencia: await insertTransaction(outraCard, "t6", "PADARIA DO ZE", "automatic", "outros"),
  };
});

describe("correção de categoria", () => {
  it("lista as categorias na ordem do catálogo", async () => {
    const list = await listCategories();
    expect(list[0].name).toBe("Moradia");
    expect(list).toHaveLength(27);
  });

  it("somente nesta transação: marca como escolha do usuário e não cria regra", async () => {
    const result = await correctCategory(lucas, ids.alvo, category.supermercado, "transaction");

    expect(result).toEqual({ ok: true, message: "Categoria alterada para Supermercado somente nesta transação." });
    expect(await row(ids.alvo)).toEqual({ category: "supermercado", source: "user" });
    expect(await row(ids.anterior)).toEqual({ category: "outros", source: "automatic" });
    expect(await db().$count(categoryRules)).toBe(0);
  });

  it("permite deixar uma transação sem categoria", async () => {
    await correctCategory(lucas, ids.alvo, null, "transaction");

    expect(await row(ids.alvo)).toEqual({ category: null, source: "user" });
  });

  it("esta e as próximas: cria a regra sem mexer no histórico", async () => {
    const result = await correctCategory(lucas, ids.alvo, category.supermercado, "merchant");

    expect(result.ok).toBe(true);
    expect(await row(ids.alvo)).toEqual({ category: "supermercado", source: "rule" });
    expect(await row(ids.anterior)).toEqual({ category: "outros", source: "automatic" });
    const [rule] = await db().select().from(categoryRules);
    expect(rule).toMatchObject({
      householdId: null,
      ownerMemberId: lucas.memberId,
      merchantName: "PADARIA DO ZE",
      categoryId: category.supermercado,
      createdByMemberId: lucas.memberId,
    });
  });

  it("incluindo o histórico: aplica nas contas do dono e preserva as exceções do usuário", async () => {
    const result = await correctCategory(lucas, ids.alvo, category.supermercado, "merchant_history");

    expect(result).toEqual({
      ok: true,
      message:
        "Categoria alterada para Supermercado em PADARIA DO ZE, incluindo 1 transação anterior. Ajustes feitos só numa transação foram mantidos.",
    });
    expect(await row(ids.anterior)).toEqual({ category: "supermercado", source: "rule" });
    expect(await row(ids.daKarina)).toEqual({ category: null, source: null });
    expect(await row(ids.excecao)).toEqual({ category: "restaurantes", source: "user" });
    expect(await row(ids.outroEstabelecimento)).toEqual({ category: "outros", source: "automatic" });
    expect(await row(ids.outraResidencia)).toEqual({ category: "outros", source: "automatic" });
  });

  it("informa quando não havia transações anteriores para atualizar", async () => {
    const result = await correctCategory(lucas, ids.outroEstabelecimento, category.supermercado, "merchant_history");

    expect(result).toEqual({
      ok: true,
      message:
        "Categoria alterada para Supermercado em LOJA, incluindo nenhuma transação anterior. Ajustes feitos só numa transação foram mantidos.",
    });
  });

  it("atualiza a regra existente do estabelecimento em vez de duplicar", async () => {
    await correctCategory(lucas, ids.alvo, category.supermercado, "merchant");
    await correctCategory(lucas, ids.anterior, category.restaurantes, "merchant");

    const rules = await db().select().from(categoryRules);
    expect(rules).toHaveLength(1);
    expect(rules[0].categoryId).toBe(category.restaurantes);
  });

  it("exige uma categoria para criar regra", async () => {
    expect(await correctCategory(lucas, ids.alvo, null, "merchant")).toEqual({
      ok: false,
      error: "Escolha uma categoria para criar uma regra.",
    });
  });

  it("só o dono da conta altera a categoria, mesmo em conta compartilhada", async () => {
    expect(await correctCategory(lucas, ids.daKarina, category.supermercado, "transaction")).toEqual({
      ok: false,
      error: "A categoria só pode ser alterada por quem conectou a conta.",
    });
    expect(await row(ids.daKarina)).toEqual({ category: null, source: null });
    expect(await db().$count(categoryRules)).toBe(0);
  });

  it("sem residência, o dono cria regra e corrige o histórico", async () => {
    const solo = { memberId: lucas.memberId, householdId: null };

    const result = await correctCategory(solo, ids.alvo, category.supermercado, "merchant_history");

    expect(result.ok).toBe(true);
    expect(await row(ids.anterior)).toEqual({ category: "supermercado", source: "rule" });
  });

  it("não deixa corrigir transação de outra residência", async () => {
    expect(await correctCategory(lucas, ids.outraResidencia, category.supermercado, "transaction")).toEqual({
      ok: false,
      error: "Transação não encontrada.",
    });
    expect(await row(ids.outraResidencia)).toEqual({ category: "outros", source: "automatic" });
  });

  it.each([
    ["transação inválida", "nao-e-uuid", "00000000-0000-4000-8000-000000000000"],
    ["categoria inexistente", "", "00000000-0000-4000-8000-000000000000"],
  ])("recusa %s", async (_caso, transactionId, categoryId) => {
    const result = await correctCategory(lucas, transactionId || ids.alvo, categoryId, "transaction");
    expect(result.ok).toBe(false);
  });
});
