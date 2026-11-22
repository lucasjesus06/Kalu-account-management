import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  categories,
  creditCardBills,
  financialAccounts,
  integrationConnections,
  transactions,
} from "@/db/schema";
import { createTestDatabase, seedHousehold } from "@/test/database";

const state = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("@/db/client", () => ({ getDb: () => state.db }));

const { getCardBillDetail, OPEN_CYCLE } = await import("./bills");

type TestDb = Awaited<ReturnType<typeof createTestDatabase>>;
const db = () => state.db as TestDb;

const OUTUBRO = "fatura-outubro";
const NOVEMBRO = "fatura-novembro";

let householdId: string;
let cardId: string;

async function categoryId(slug: string) {
  const [category] = await db().select().from(categories).where(eq(categories.slug, slug));
  return category.id;
}

beforeEach(async () => {
  state.db = await createTestDatabase();
  const { household, lucas } = await seedHousehold(db());
  householdId = household.id;
  const [connection] = await db()
    .insert(integrationConnections)
    .values({ memberId: lucas.id, externalItemId: "item", institutionName: "Santander" })
    .returning();
  const [card] = await db()
    .insert(financialAccounts)
    .values({
      connectionId: connection.id,
      externalId: "cartao",
      kind: "credit_card",
      name: "ELITE VISA",
      numberLast4: "1234",
      currency: "BRL",
      balanceCents: 0,
    })
    .returning();
  cardId = card.id;
  await db()
    .insert(creditCardBills)
    .values([
      { accountId: cardId, externalId: OUTUBRO, dueDate: "2026-10-03", totalCents: 50000, currency: "BRL" },
      { accountId: cardId, externalId: NOVEMBRO, dueDate: "2026-11-03", totalCents: 40000, currency: "BRL" },
    ]);

  const mercado = await categoryId("supermercado");
  const restaurantes = await categoryId("restaurantes");
  const base = { accountId: cardId, currency: "BRL", status: "posted" as const, categorySource: "automatic" as const };
  await db()
    .insert(transactions)
    .values([
      { ...base, externalId: "o1", occurredAt: new Date("2026-09-10T12:00:00Z"), description: "ASSAI", merchantName: "ASSAI", amountCents: 45000, direction: "outflow", billExternalId: OUTUBRO, categoryId: mercado },
      { ...base, externalId: "n1", occurredAt: new Date("2026-10-10T12:00:00Z"), description: "ASSAI", merchantName: "ASSAI", amountCents: 20000, direction: "outflow", billExternalId: NOVEMBRO, categoryId: mercado },
      { ...base, externalId: "n2", occurredAt: new Date("2026-10-12T12:00:00Z"), description: "IFD*TESTE", merchantName: "TESTE", amountCents: 8000, direction: "outflow", billExternalId: NOVEMBRO, categoryId: restaurantes, installmentNumber: 1, installmentTotal: 4 },
      { ...base, externalId: "n3", occurredAt: new Date("2026-10-13T12:00:00Z"), description: "IFD*TESTE", merchantName: "TESTE", amountCents: 1000, direction: "inflow", billExternalId: NOVEMBRO, categoryId: restaurantes },
      { ...base, externalId: "n4", occurredAt: new Date("2026-10-05T12:00:00Z"), description: "PAGAMENTO DE FATURA", merchantName: "PAGAMENTO DE FATURA", amountCents: 50000, direction: "inflow", billExternalId: NOVEMBRO },
      { ...base, externalId: "a1", occurredAt: new Date("2026-11-10T12:00:00Z"), description: "LOJA", merchantName: "LOJA", amountCents: 3000, direction: "outflow", billExternalId: null },
      { ...base, externalId: "a2", occurredAt: new Date("2026-11-05T12:00:00Z"), description: "PAGAMENTO DE FATURA", merchantName: "PAGAMENTO DE FATURA", amountCents: 30000, direction: "inflow", billExternalId: null },
    ]);
});

describe("detalhe da fatura", () => {
  it("abre na fatura aberta e lista os ciclos do mais recente para o mais antigo", async () => {
    const detail = await getCardBillDetail(householdId, cardId, undefined);

    expect(detail!.cycles).toEqual([
      { key: OPEN_CYCLE, dueDate: null },
      { key: NOVEMBRO, dueDate: "2026-11-03" },
      { key: OUTUBRO, dueDate: "2026-10-03" },
    ]);
    expect(detail!.selected).toMatchObject({ key: OPEN_CYCLE, isOpen: true, composition: { netCents: 3000 } });
    expect(detail!.categories.map((c) => [c.name, c.netCents])).toEqual([["Sem categoria", 3000]]);
  });

  it("detalha a fatura fechada por categoria, estabelecimento, créditos e parcelas futuras", async () => {
    const detail = await getCardBillDetail(householdId, cardId, NOVEMBRO);

    expect(detail!.selected).toMatchObject({
      key: NOVEMBRO,
      isOpen: false,
      composition: { officialTotalCents: 40000, netCents: 27000, unidentifiedCents: 13000, billPaymentsCents: 50000 },
    });
    expect(detail!.categories.map((c) => [c.name, c.netCents, c.count])).toEqual([
      ["Supermercado", 20000, 1],
      ["Restaurantes e delivery", 7000, 2],
    ]);
    expect(detail!.merchants.map((m) => m.name)).toEqual(["ASSAI", "TESTE"]);
    expect(detail!.credits.map((c) => [c.merchantName, c.amountCents])).toEqual([["TESTE", 1000]]);
    expect(detail!.installments.map((i) => [i.line.merchantName, i.remaining, i.remainingCents])).toEqual([["TESTE", 3, 24000]]);
  });

  it("considera paga a fatura cujo pagamento aparece no ciclo seguinte", async () => {
    const outubro = await getCardBillDetail(householdId, cardId, OUTUBRO);
    const novembro = await getCardBillDetail(householdId, cardId, NOVEMBRO);

    expect(outubro!.selected).toMatchObject({ paidCents: 50000, status: "paid" });
    expect(novembro!.selected).toMatchObject({ paidCents: 30000, status: "partially_paid" });
  });

  it("volta para a fatura aberta quando o ciclo pedido não existe", async () => {
    const detail = await getCardBillDetail(householdId, cardId, "inexistente");

    expect(detail!.selected.key).toBe(OPEN_CYCLE);
  });

  it("não mostra cartão de outra residência", async () => {
    const outra = await seedHousehold(db());

    expect(await getCardBillDetail(outra.household.id, cardId, undefined)).toBeNull();
  });
});
