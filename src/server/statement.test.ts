import { householdScope } from "@/domain/scope";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { categories, financialAccounts, integrationConnections, transactions } from "@/db/schema";
import { createTestDatabase, seedHousehold, shareWithMemberHousehold } from "@/test/database";

const state = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("@/db/client", () => ({ getDb: () => state.db }));

const { getAccountStatement } = await import("./statement");

type TestDb = Awaited<ReturnType<typeof createTestDatabase>>;
const db = () => state.db as TestDb;

let householdId: string;
let checkingId: string;
let cardId: string;

beforeEach(async () => {
  state.db = await createTestDatabase();
  const { household, lucas } = await seedHousehold(db());
  householdId = household.id;
  const [connection] = await db()
    .insert(integrationConnections)
    .values({ memberId: lucas.id, externalItemId: "item", institutionName: "Santander" })
    .returning();
  const [checking, card] = await db()
    .insert(financialAccounts)
    .values([
      { connectionId: connection.id, externalId: "cc", kind: "checking", name: "Conta Corrente", currency: "BRL", balanceCents: 100000 },
      { connectionId: connection.id, externalId: "cartao", kind: "credit_card", name: "Cartão", currency: "BRL", balanceCents: 0 },
    ])
    .returning();
  checkingId = checking.id;
  cardId = card.id;
  await shareWithMemberHousehold(db(), checkingId, lucas.id);
  await shareWithMemberHousehold(db(), cardId, lucas.id);
  const [transfer] = await db().select().from(categories).where(eq(categories.slug, "transferencia-entre-integrantes"));
  const base = { accountId: checkingId, currency: "BRL", status: "posted" as const };
  await db()
    .insert(transactions)
    .values([
      { ...base, externalId: "out-1", occurredAt: new Date("2026-10-31T23:30:00-03:00"), description: "MERCADO", amountCents: 5000, direction: "outflow" },
      { ...base, externalId: "nov-1", occurredAt: new Date("2026-11-01T00:30:00-03:00"), description: "SALARIO", amountCents: 500000, direction: "inflow" },
      { ...base, externalId: "nov-2", occurredAt: new Date("2026-11-05T12:00:00-03:00"), description: "PIX KARINA", amountCents: 20000, direction: "outflow", categoryId: transfer.id, categorySource: "user" },
      { ...base, externalId: "nov-3", occurredAt: new Date("2026-11-10T12:00:00-03:00"), description: "PAGAMENTO CARTAO", providerCategory: "Credit card payment", amountCents: 403477, direction: "outflow" },
    ]);
});

describe("extrato da conta", () => {
  it("abre no mês mais recente, pelo fuso de Brasília, com o resumo sem transferências e sem pagamento de fatura", async () => {
    const statement = await getAccountStatement(householdScope(householdId), checkingId, undefined);

    expect(statement!.months).toEqual(["2026-11", "2026-10"]);
    expect(statement!.selectedMonth).toBe("2026-11");
    expect(statement!.lines.map((line) => line.description)).toEqual(["PAGAMENTO CARTAO", "PIX KARINA", "SALARIO"]);
    expect(statement!.lines[1].category).toEqual({
      slug: "transferencia-entre-integrantes",
      name: "Transferência entre integrantes",
      kind: "transfer",
    });
    expect(statement!.summary).toEqual({
      incomeCents: 500000,
      spendingCents: 0,
      billPaymentsCents: 403477,
      transfersInCents: 0,
      transfersOutCents: 20000,
    });
  });

  it("mostra o mês pedido e volta para o mais recente quando o mês é inválido", async () => {
    expect((await getAccountStatement(householdScope(householdId), checkingId, "2026-10"))!.lines.map((l) => l.description)).toEqual(["MERCADO"]);
    expect((await getAccountStatement(householdScope(householdId), checkingId, "2026-13"))!.selectedMonth).toBe("2026-11");
    expect((await getAccountStatement(householdScope(householdId), checkingId, "2025-01"))!.selectedMonth).toBe("2026-11");
  });

  it("não abre cartão, conta de outra residência nem identificador inválido", async () => {
    const outra = await seedHousehold(db());

    expect(await getAccountStatement(householdScope(householdId), cardId, undefined)).toBeNull();
    expect(await getAccountStatement(householdScope(outra.household.id), checkingId, undefined)).toBeNull();
    expect(await getAccountStatement(householdScope(householdId), "nao-e-uuid", undefined)).toBeNull();
  });
});
