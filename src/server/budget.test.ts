import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { budgetAlerts, budgetGoals, categories, financialAccounts, integrationConnections, transactions } from "@/db/schema";
import { createTestDatabase, seedHousehold } from "@/test/database";

const state = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("@/db/client", () => ({ getDb: () => state.db }));

const { evaluateBudgetAlerts, getBudgetOverview, listAlerts, listGoals, removeGoal, saveGoal } = await import("./budget");

type TestDb = Awaited<ReturnType<typeof createTestDatabase>>;
const db = () => state.db as TestDb;

const nbsp = (text: string) => text.replace(/R\$ /g, "R$\u00a0");

const NOW = new Date("2026-11-20T15:00:00-03:00");
const DECEMBER = new Date("2026-12-05T15:00:00-03:00");

let lucas: { memberId: string; householdId: string };
let karinaId: string;
let outra: { memberId: string; householdId: string; card: string };
let card: string;
let category: Record<string, string>;
let sequence = 0;

async function accountFor(memberId: string, externalId: string) {
  const [connection] = await db()
    .insert(integrationConnections)
    .values({ memberId, externalItemId: `item-${externalId}`, institutionName: "Banco" })
    .returning();
  const [account] = await db()
    .insert(financialAccounts)
    .values({ connectionId: connection.id, externalId, kind: "credit_card", name: "Cartão", currency: "BRL", balanceCents: 0 })
    .returning();
  return account.id;
}

async function spend(accountId: string, amountCents: number, slug: string, occurredAt = "2026-11-10T12:00:00-03:00") {
  sequence += 1;
  await db()
    .insert(transactions)
    .values({
      accountId,
      externalId: `t${sequence}`,
      occurredAt: new Date(occurredAt),
      description: "COMPRA",
      merchantName: "LOJA",
      amountCents,
      direction: "outflow",
      status: "posted",
      currency: "BRL",
      categoryId: category[slug],
      categorySource: "automatic",
    });
}

function goalInput(overrides: Partial<Parameters<typeof saveGoal>[1]> = {}) {
  return { categoryId: category.restaurantes, expense: "", limit: "500", thresholds: "70, 90, 100", ...overrides };
}

async function alertThresholds() {
  return (await db().select().from(budgetAlerts).orderBy(budgetAlerts.threshold)).map((alert) => alert.threshold);
}

beforeEach(async () => {
  state.db = await createTestDatabase();
  category = Object.fromEntries((await db().select().from(categories)).map((c) => [c.slug, c.id]));
  const seeded = await seedHousehold(db());
  lucas = { memberId: seeded.lucas.id, householdId: seeded.household.id };
  karinaId = seeded.karina.id;
  card = await accountFor(seeded.lucas.id, "cartao-lucas");
  const other = await seedHousehold(db());
  outra = { memberId: other.lucas.id, householdId: other.household.id, card: await accountFor(other.lucas.id, "cartao-outra") };
});

describe("cadastro de metas", () => {
  it("cria a meta a partir do mês atual", async () => {
    const result = await saveGoal(lucas, goalInput({ limit: "1.200,50", expense: "shared" }), NOW);

    expect(result).toEqual({ ok: true, message: nbsp("Meta de Restaurantes e delivery · Compartilhado criada: R$ 1.200,50 por mês.") });
    const [goal] = await listGoals(lucas.householdId);
    expect(goal).toMatchObject({
      categorySlug: "restaurantes",
      nature: "shared",
      limitCents: 120050,
      thresholds: [70, 90, 100],
      startsMonth: "2026-11",
      endsMonth: null,
    });
  });

  it("aceita meta para todo o consumo de um integrante", async () => {
    const result = await saveGoal(lucas, goalInput({ categoryId: "", expense: karinaId }), NOW);

    expect(result).toEqual({ ok: true, message: nbsp("Meta de Todo o consumo · Karina criada: R$ 500,00 por mês.") });
  });

  it.each([
    ["valor inválido", { limit: "abc" }, "Informe o valor da meta, por exemplo 500 ou 1.200,50."],
    ["avisos inválidos", { thresholds: "0" }, "Informe até 5 percentuais entre 1 e 300 para os avisos, por exemplo 70, 90, 100."],
    ["integrante de outra residência", {}, "Escolha para quem vale a meta."],
    ["categoria de transferência", {}, "Categoria não encontrada."],
  ])("recusa %s", async (caso, overrides, error) => {
    const input =
      caso === "integrante de outra residência"
        ? goalInput({ expense: outra.memberId })
        : caso === "categoria de transferência"
          ? goalInput({ categoryId: category["transferencia-entre-integrantes"] })
          : goalInput(overrides);

    expect(await saveGoal(lucas, input, NOW)).toEqual({ ok: false, error });
    expect(await db().$count(budgetGoals)).toBe(0);
  });

  it("não deixa duas metas para a mesma categoria e para quem", async () => {
    await saveGoal(lucas, goalInput(), NOW);
    await saveGoal(lucas, goalInput({ expense: "household" }), NOW);

    expect(await saveGoal(lucas, goalInput({ limit: "800" }), NOW)).toEqual({
      ok: false,
      error: "Já existe uma meta para essa categoria e para quem. Edite a meta existente.",
    });
  });

  it("editar no mesmo mês altera a meta sem criar versão", async () => {
    await saveGoal(lucas, goalInput(), NOW);
    const [goal] = await listGoals(lucas.householdId);

    const result = await saveGoal(lucas, goalInput({ goalId: goal.id, limit: "650", thresholds: "80, 100" }), NOW);

    expect(result).toEqual({ ok: true, message: nbsp("Meta de Restaurantes e delivery atualizada: R$ 650,00 por mês.") });
    expect(await listGoals(lucas.householdId)).toEqual([
      expect.objectContaining({ id: goal.id, limitCents: 65000, thresholds: [80, 100], startsMonth: "2026-11" }),
    ]);
  });

  it("editar num mês seguinte preserva o valor antigo nos meses anteriores", async () => {
    await saveGoal(lucas, goalInput(), NOW);
    const [goal] = await listGoals(lucas.householdId);

    const result = await saveGoal(lucas, goalInput({ goalId: goal.id, limit: "650" }), DECEMBER);

    expect(result.ok && result.message).toBe(
      nbsp("Meta de Restaurantes e delivery atualizada: R$ 650,00 por mês a partir deste mês. Os meses anteriores mantêm o valor antigo."),
    );
    expect((await listGoals(lucas.householdId, "2026-11")).map((g) => [g.limitCents, g.startsMonth, g.endsMonth])).toEqual([
      [50000, "2026-11", "2026-11"],
    ]);
    expect((await listGoals(lucas.householdId, "2026-12")).map((g) => [g.limitCents, g.startsMonth, g.endsMonth])).toEqual([
      [65000, "2026-12", null],
    ]);
  });

  it("remover no mês em que foi criada apaga a meta; depois disso, encerra no mês anterior", async () => {
    await saveGoal(lucas, goalInput(), NOW);
    await saveGoal(lucas, goalInput({ categoryId: category.supermercado }), NOW);
    const goals = await listGoals(lucas.householdId);
    const restaurantes = goals.find((g) => g.categorySlug === "restaurantes")!;
    const mercado = goals.find((g) => g.categorySlug === "supermercado")!;

    expect(await removeGoal(lucas, restaurantes.id, NOW)).toEqual({ ok: true, message: "Meta removida." });
    expect(await removeGoal(lucas, mercado.id, DECEMBER)).toEqual({
      ok: true,
      message: "Meta encerrada. Ela continua aparecendo nos meses em que valeu.",
    });
    expect((await listGoals(lucas.householdId)).map((g) => [g.categorySlug, g.endsMonth])).toEqual([["supermercado", "2026-11"]]);
    expect(await listGoals(lucas.householdId, "2026-12")).toEqual([]);
  });

  it("não edita nem remove meta de outra residência", async () => {
    await saveGoal(outra, goalInput(), NOW);
    const [goal] = await listGoals(outra.householdId);

    expect(await saveGoal(lucas, goalInput({ goalId: goal.id }), NOW)).toEqual({ ok: false, error: "Meta não encontrada." });
    expect(await removeGoal(lucas, goal.id, NOW)).toEqual({ ok: false, error: "Meta não encontrada." });
  });
});

describe("avisos das metas", () => {
  it("avisa cada percentual uma vez só, à medida que o consumo cresce", async () => {
    await saveGoal(lucas, goalInput(), NOW);
    await spend(card, 36000, "restaurantes");
    await spend(card, 90000, "supermercado");

    expect(await evaluateBudgetAlerts(lucas.householdId, NOW)).toBe(1);
    expect(await evaluateBudgetAlerts(lucas.householdId, NOW)).toBe(0);
    expect(await alertThresholds()).toEqual([70]);

    await spend(card, 15000, "restaurantes");
    expect(await evaluateBudgetAlerts(lucas.householdId, NOW)).toBe(2);
    expect(await alertThresholds()).toEqual([70, 90, 100]);
    const [latest] = await listAlerts(lucas.householdId);
    expect(latest).toMatchObject({ label: "Restaurantes e delivery", month: "2026-11", threshold: 100, consumedCents: 51000, limitCents: 50000 });
  });

  it("salvar uma meta já avalia o consumo do mês", async () => {
    await spend(card, 46000, "restaurantes");

    await saveGoal(lucas, goalInput(), NOW);

    expect(await alertThresholds()).toEqual([70, 90]);
  });

  it("não mistura consumo nem avisos de outra residência", async () => {
    await saveGoal(lucas, goalInput(), NOW);
    await saveGoal(outra, goalInput(), NOW);
    await spend(outra.card, 60000, "restaurantes");

    expect(await evaluateBudgetAlerts(lucas.householdId, NOW)).toBe(0);
    expect(await evaluateBudgetAlerts(outra.householdId, NOW)).toBe(3);
    expect(await listAlerts(lucas.householdId)).toEqual([]);
    expect((await listAlerts(outra.householdId)).length).toBe(3);
  });

  it("mostra o progresso de cada meta no mês, com o valor que valia nele", async () => {
    await saveGoal(lucas, goalInput(), NOW);
    await spend(card, 40000, "restaurantes");
    await spend(card, 10000, "restaurantes", "2026-10-15T12:00:00-03:00");

    const [overview] = await getBudgetOverview(lucas.householdId, "2026-11");

    expect(overview.label).toBe("Restaurantes e delivery");
    expect(overview.progress).toMatchObject({ consumedCents: 40000, percent: 80, status: "warning" });
    expect(await getBudgetOverview(lucas.householdId, "2026-10")).toEqual([]);
  });

  it("não reavalia metas encerradas", async () => {
    await saveGoal(lucas, goalInput(), NOW);
    const [goal] = await listGoals(lucas.householdId);
    await db().update(budgetGoals).set({ endsMonth: "2026-11" }).where(eq(budgetGoals.id, goal.id));
    await spend(card, 60000, "restaurantes", "2026-12-02T12:00:00-03:00");

    expect(await evaluateBudgetAlerts(lucas.householdId, DECEMBER)).toBe(0);
  });
});
