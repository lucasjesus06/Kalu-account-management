import { householdScope } from "@/domain/scope";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { categories, creditCardBills, financialAccounts, integrationConnections, transactions } from "@/db/schema";
import { createTestDatabase, seedHousehold, shareWithMemberHousehold } from "@/test/database";

const state = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("@/db/client", () => ({ getDb: () => state.db, getServiceDb: () => state.db, asService: <T>(work: () => Promise<T>) => work() }));

const { getConsumptionComparison, getDataCoverage, loadConsumptionRecords } = await import("./consumption");

type TestDb = Awaited<ReturnType<typeof createTestDatabase>>;
const db = () => state.db as TestDb;

const NOW = new Date("2026-11-22T10:00:00-03:00");
let householdId: string;
let otherHouseholdId: string;

async function account(memberId: string, kind: "checking" | "credit_card", name: string, extra: Record<string, number> = {}) {
  const [connection] = await db()
    .insert(integrationConnections)
    .values({ memberId, externalItemId: `item-${name}`, institutionName: "Santander", lastSyncedAt: new Date("2026-11-22T06:00:00-03:00") })
    .returning();
  const [row] = await db()
    .insert(financialAccounts)
    .values({ connectionId: connection.id, externalId: name, kind, name, currency: "BRL", balanceCents: 0, ...extra })
    .returning();
  await shareWithMemberHousehold(db(), row.id, memberId);
  return row.id;
}

beforeEach(async () => {
  state.db = await createTestDatabase();
  const { household, lucas, karina } = await seedHousehold(db());
  householdId = household.id;
  const card = await account(lucas.id, "credit_card", "Cartão Lucas", { creditLimitCents: 800000, creditUsedCents: 300000 });
  const checking = await account(karina.id, "checking", "Conta Karina", { balanceCents: 250000 });
  const outra = await seedHousehold(db());
  otherHouseholdId = outra.household.id;
  const otherCard = await account(outra.lucas.id, "credit_card", "Cartão de outra casa");

  const slug = Object.fromEntries((await db().select().from(categories)).map((c) => [c.slug, c.id]));
  await db().insert(creditCardBills).values({ accountId: card, externalId: "fatura", dueDate: "2026-11-03", totalCents: 403477, currency: "BRL" });
  const tx = (accountId: string, externalId: string, date: string, amountCents: number, extra: Record<string, unknown> = {}) => ({
    accountId,
    externalId,
    occurredAt: new Date(date),
    description: externalId.toUpperCase(),
    merchantName: externalId.toUpperCase(),
    amountCents,
    direction: "outflow" as const,
    status: "posted" as const,
    currency: "BRL",
    ...extra,
  });
  await db().insert(transactions).values([
    tx(card, "mercado-out", "2026-10-05T12:00:00-03:00", 20000, { categoryId: slug.supermercado }),
    tx(card, "mercado-out-tarde", "2026-10-25T12:00:00-03:00", 99900, { categoryId: slug.supermercado }),
    tx(card, "mercado-nov", "2026-11-05T12:00:00-03:00", 30000, { categoryId: slug.supermercado }),
    tx(card, "uber-nov", "2026-11-06T12:00:00-03:00", 4000, { categoryId: slug["transporte-por-aplicativo"] }),
    tx(card, "pagamento", "2026-11-07T12:00:00-03:00", 403477, { direction: "inflow", description: "PAGAMENTO DE FATURA" }),
    tx(card, "pix-karina", "2026-11-08T12:00:00-03:00", 15000, { categoryId: slug["transferencia-entre-integrantes"] }),
    tx(checking, "padaria-nov", "2026-11-09T12:00:00-03:00", 1500),
    tx(checking, "salario", "2026-11-05T09:00:00-03:00", 500000, { direction: "inflow" }),
    tx(otherCard, "outra-casa", "2026-11-05T12:00:00-03:00", 77700),
  ]);
});

describe("consumo da residência", () => {
  it("carrega só as transações da residência, com conta, integrante e categoria", async () => {
    const { records, billTotals } = await loadConsumptionRecords(householdScope(householdId));

    expect(records).toHaveLength(8);
    expect(billTotals).toEqual([403477]);
    expect(records.find((r) => r.merchantName === "PADARIA-NOV")).toMatchObject({
      accountKind: "checking",
      accountName: "Conta Karina",
      memberName: "Karina",
      category: null,
    });
  });

  it("compara o mês corrente com o mesmo intervalo do mês anterior", async () => {
    const comparison = await getConsumptionComparison(householdScope(householdId), undefined, undefined, NOW);

    expect(comparison.month).toBe("2026-11");
    expect(comparison.compareTo).toBe("2026-10");
    expect(comparison.periods.partial).toBe(true);
    expect(comparison.current).toMatchObject({
      consumptionCents: 30000 + 4000 + 1500,
      purchasesCount: 3,
      incomeCents: 500000,
      billPaymentsReceivedCents: 403477,
      billPaymentsFromAccountsCents: 0,
      transfersOutCents: 15000,
      uncategorizedCents: 1500,
    });
    expect(comparison.previous).toMatchObject({ consumptionCents: 20000, purchasesCount: 1 });
    expect(comparison.byCategory[0]).toMatchObject({ key: "supermercado", currentCents: 30000, previousCents: 20000, deltaPercent: 50 });
    expect(comparison.months).toEqual(["2026-11", "2026-10"]);
  });

  it("compara meses inteiros escolhidos", async () => {
    const comparison = await getConsumptionComparison(householdScope(householdId), "2026-10", "2026-11", NOW);

    expect(comparison.periods.partial).toBe(false);
    expect(comparison.current.consumptionCents).toBe(20000 + 99900);
  });

  it("usa o mês corrente e o anterior quando os meses pedidos são inválidos ou iguais", async () => {
    expect(await getConsumptionComparison(householdScope(householdId), "2026-13", "x", NOW)).toMatchObject({ month: "2026-11", compareTo: "2026-10" });
    expect(await getConsumptionComparison(householdScope(householdId), "2026-09", "2026-09", NOW)).toMatchObject({ month: "2026-09", compareTo: "2026-08" });
  });

  it("informa a cobertura dos dados, saldos e limite utilizado", async () => {
    expect(await getDataCoverage(householdScope(householdId))).toEqual({
      firstTransactionAt: new Date("2026-10-05T12:00:00-03:00"),
      lastTransactionAt: new Date("2026-11-09T12:00:00-03:00"),
      transactionsCount: 8,
      lastSyncedAt: new Date("2026-11-22T06:00:00-03:00"),
      balanceCents: 250000,
      creditUsedCents: 300000,
      creditLimitCents: 800000,
    });
    expect((await getDataCoverage(householdScope(otherHouseholdId))).transactionsCount).toBe(1);
  });
});
