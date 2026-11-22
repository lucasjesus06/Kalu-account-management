import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { categories, expenseNatureRules, financialAccounts, integrationConnections, transactions } from "@/db/schema";
import { createTestDatabase, seedHousehold, shareWithMemberHousehold } from "@/test/database";

const state = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("@/db/client", () => ({ getDb: () => state.db }));

const { correctCategory } = await import("./categorization");
const { correctExpenseNature, loadExpenseNatureRules, refreshExpenseNature } = await import("./expense-nature");

type TestDb = Awaited<ReturnType<typeof createTestDatabase>>;
const db = () => state.db as TestDb;
const executor = () => state.db as Parameters<typeof refreshExpenseNature>[0];

let lucas: { memberId: string; householdId: string };
let karinaId: string;
let outroIntegrante: string;
let lucasCard: string;
let ids: Record<string, string>;
let category: Record<string, string>;

async function insertTransaction(
  accountId: string,
  externalId: string,
  merchantName: string,
  slug: string | null,
  expense: Partial<typeof transactions.$inferInsert> = {},
) {
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
      categorySource: slug ? "automatic" : null,
      ...expense,
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
    .select({
      nature: transactions.expenseNature,
      memberId: transactions.expenseMemberId,
      source: transactions.expenseNatureSource,
    })
    .from(transactions)
    .where(eq(transactions.id, id));
  return result;
}

const pending = { nature: null, memberId: null, source: null };
const evaluated = { nature: null, memberId: null, source: "automatic" };

beforeEach(async () => {
  state.db = await createTestDatabase();
  category = Object.fromEntries((await db().select().from(categories)).map((c) => [c.slug, c.id]));
  const seeded = await seedHousehold(db());
  lucas = { memberId: seeded.lucas.id, householdId: seeded.household.id };
  karinaId = seeded.karina.id;
  lucasCard = await accountFor(seeded.lucas.id, "cartao-lucas");
  const karinaCard = await accountFor(seeded.karina.id, "cartao-karina");
  const outra = await seedHousehold(db());
  outroIntegrante = outra.lucas.id;
  const outraCard = await accountFor(outra.lucas.id, "cartao-outra");
  ids = {
    alvo: await insertTransaction(lucasCard, "t1", "IFOOD", "restaurantes"),
    anterior: await insertTransaction(lucasCard, "t2", "IFOOD", "restaurantes"),
    daKarina: await insertTransaction(karinaCard, "t3", "IFOOD", "restaurantes"),
    excecao: await insertTransaction(lucasCard, "t4", "IFOOD", "restaurantes", {
      expenseNature: "individual",
      expenseMemberId: seeded.lucas.id,
      expenseNatureSource: "user",
    }),
    mercado: await insertTransaction(lucasCard, "t5", "SONDA", "supermercado", {
      expenseNature: "household",
      expenseNatureSource: "automatic",
    }),
    outraResidencia: await insertTransaction(outraCard, "t6", "IFOOD", "restaurantes"),
  };
});

describe("correção de para quem", () => {
  it("somente nesta transação: marca como escolha do usuário e não cria regra", async () => {
    const result = await correctExpenseNature(lucas, ids.alvo, karinaId, "transaction");

    expect(result).toEqual({ ok: true, message: "Para quem alterado para Karina somente nesta transação." });
    expect(await row(ids.alvo)).toEqual({ nature: "individual", memberId: karinaId, source: "user" });
    expect(await row(ids.anterior)).toEqual(pending);
    expect(await db().$count(expenseNatureRules)).toBe(0);
  });

  it("permite voltar uma transação para sem definição, sem que a categoria a remarque", async () => {
    await correctExpenseNature(lucas, ids.mercado, "", "transaction");

    expect(await row(ids.mercado)).toEqual({ nature: null, memberId: null, source: "user" });
  });

  it("esta e as próximas: cria a regra sem mexer no histórico", async () => {
    const result = await correctExpenseNature(lucas, ids.alvo, "shared", "merchant");

    expect(result).toEqual({
      ok: true,
      message: "Para quem alterado para Compartilhado. As próximas transações de IFOOD também serão marcadas assim.",
    });
    expect(await row(ids.alvo)).toEqual({ nature: "shared", memberId: null, source: "rule" });
    expect(await row(ids.anterior)).toEqual(pending);
    const [rule] = await db().select().from(expenseNatureRules);
    expect(rule).toMatchObject({
      householdId: lucas.householdId,
      merchantName: "IFOOD",
      expenseNature: "shared",
      expenseMemberId: null,
      createdByMemberId: lucas.memberId,
    });
  });

  it("incluindo o histórico: aplica na residência inteira e preserva as exceções do usuário", async () => {
    const result = await correctExpenseNature(lucas, ids.alvo, "shared", "merchant_history");

    expect(result).toEqual({
      ok: true,
      message:
        "Para quem alterado para Compartilhado em IFOOD, incluindo 2 transações anteriores. Ajustes feitos só numa transação foram mantidos.",
    });
    expect(await row(ids.anterior)).toEqual({ nature: "shared", memberId: null, source: "rule" });
    expect(await row(ids.daKarina)).toEqual({ nature: "shared", memberId: null, source: "rule" });
    expect(await row(ids.excecao)).toEqual({ nature: "individual", memberId: lucas.memberId, source: "user" });
    expect(await row(ids.outraResidencia)).toEqual(pending);
  });

  it("atualiza a regra existente do estabelecimento em vez de duplicar", async () => {
    await correctExpenseNature(lucas, ids.alvo, "shared", "merchant");
    await correctExpenseNature(lucas, ids.anterior, karinaId, "merchant");

    const rules = await db().select().from(expenseNatureRules);
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ expenseNature: "individual", expenseMemberId: karinaId });
  });

  it("exige uma escolha para criar regra", async () => {
    expect(await correctExpenseNature(lucas, ids.alvo, "", "merchant")).toEqual({
      ok: false,
      error: "Escolha para quem é o gasto para criar uma regra.",
    });
  });

  it.each([
    ["integrante de outra residência", () => outroIntegrante],
    ["valor desconhecido", () => "todo-mundo"],
  ])("recusa %s", async (_caso, choice) => {
    expect(await correctExpenseNature(lucas, ids.alvo, choice(), "transaction")).toEqual({
      ok: false,
      error: "Escolha para quem é o gasto.",
    });
    expect(await row(ids.alvo)).toEqual(pending);
  });

  it("não deixa corrigir transação de outra residência", async () => {
    expect(await correctExpenseNature(lucas, ids.outraResidencia, "shared", "transaction")).toEqual({
      ok: false,
      error: "Transação não encontrada.",
    });
    expect(await row(ids.outraResidencia)).toEqual(pending);
  });
});

describe("para quem acompanha a categoria", () => {
  it("ao mudar a categoria para uma da residência, passa a ser Casa", async () => {
    await correctCategory(lucas, ids.alvo, category.supermercado, "transaction");

    expect(await row(ids.alvo)).toEqual({ nature: "household", memberId: null, source: "automatic" });
  });

  it("ao tirar de uma categoria da residência, deixa de ser Casa", async () => {
    await correctCategory(lucas, ids.mercado, category.restaurantes, "transaction");

    expect(await row(ids.mercado)).toEqual(evaluated);
  });

  it("ao mudar a categoria no histórico, atualiza para quem de todo o estabelecimento, menos as escolhas do usuário", async () => {
    await correctCategory(lucas, ids.alvo, category.moradia, "merchant_history");

    expect(await row(ids.anterior)).toEqual({ nature: "household", memberId: null, source: "automatic" });
    expect(await row(ids.daKarina)).toEqual({ nature: "household", memberId: null, source: "automatic" });
    expect(await row(ids.excecao)).toEqual({ nature: "individual", memberId: lucas.memberId, source: "user" });
    expect(await row(ids.outraResidencia)).toEqual(pending);
  });

  it("transferência não tem para quem", async () => {
    await correctCategory(lucas, ids.mercado, category["transferencia-entre-integrantes"], "transaction");

    expect(await row(ids.mercado)).toEqual(evaluated);
  });

  it("a regra do estabelecimento vale mais que a categoria", async () => {
    await correctExpenseNature(lucas, ids.alvo, karinaId, "merchant");
    const outra = await insertTransaction(lucasCard, "t7", "IFOOD", "supermercado");

    const rules = await loadExpenseNatureRules(executor(), lucas.householdId);

    expect(await refreshExpenseNature(executor(), eq(transactions.id, outra), rules)).toBe(1);
    expect(await row(outra)).toEqual({ nature: "individual", memberId: karinaId, source: "rule" });
    expect(await refreshExpenseNature(executor(), eq(transactions.id, outra), rules)).toBe(0);
  });
});
