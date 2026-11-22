import { beforeEach, describe, expect, it, vi } from "vitest";
import { categories, financialAccounts, integrationConnections, transactions } from "@/db/schema";
import { householdScope, personalScope } from "@/domain/scope";
import { createTestDatabase, seedHousehold } from "@/test/database";

const state = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("@/db/client", () => ({ getDb: () => state.db, getServiceDb: () => state.db, asService: <T>(work: () => Promise<T>) => work() }));

const { loadConsumptionRecords, getDataCoverage } = await import("./consumption");
const { listAccounts } = await import("./accounts");
const { listOwnAccounts, shareAccount } = await import("./sharing");
const { listChanges } = await import("./change-log");

type TestDb = Awaited<ReturnType<typeof createTestDatabase>>;
const db = () => state.db as TestDb;

let sequence = 0;

async function accountWithPurchase(memberId: string, name: string, amountCents: number) {
  sequence += 1;
  const [connection] = await db()
    .insert(integrationConnections)
    .values({ memberId, externalItemId: `item-${sequence}`, institutionName: "Banco" })
    .returning();
  const [account] = await db()
    .insert(financialAccounts)
    .values({ connectionId: connection.id, externalId: `conta-${sequence}`, kind: "checking", name, currency: "BRL", balanceCents: 0 })
    .returning();
  const [category] = await db().select().from(categories).limit(1);
  await db().insert(transactions).values({
    accountId: account.id,
    externalId: `t-${sequence}`,
    occurredAt: new Date("2026-11-10T12:00:00-03:00"),
    description: name,
    merchantName: name,
    amountCents,
    direction: "outflow",
    status: "posted",
    currency: "BRL",
    categoryId: category.id,
  });
  return account.id;
}

const totals = async (scope: Parameters<typeof loadConsumptionRecords>[0]) =>
  (await loadConsumptionRecords(scope)).records.map((record) => record.amountCents).sort((a, b) => a - b);

let lucas: { id: string };
let karina: { id: string };
let householdId: string;
let lucasAccount: string;
let karinaAccount: string;

beforeEach(async () => {
  state.db = await createTestDatabase();
  const seeded = await seedHousehold(db());
  lucas = seeded.lucas;
  karina = seeded.karina;
  householdId = seeded.household.id;
  lucasAccount = await accountWithPurchase(lucas.id, "Conta Lucas", 1000);
  karinaAccount = await accountWithPurchase(karina.id, "Conta Karina", 2000);
});

describe("escopo pessoal e residência", () => {
  it("o espaço pessoal só enxerga as próprias contas, sem precisar de residência", async () => {
    expect(await totals(personalScope(lucas.id))).toEqual([1000]);
    expect(await totals(personalScope(karina.id))).toEqual([2000]);
    expect((await listAccounts(personalScope(lucas.id))).map((a) => a.name)).toEqual(["Conta Lucas"]);
  });

  it("a residência não enxerga nada até alguém compartilhar uma conta", async () => {
    expect(await totals(householdScope(householdId))).toEqual([]);
    expect((await getDataCoverage(householdScope(householdId))).transactionsCount).toBe(0);
  });

  it("compartilhar consolida na residência por referência, sem tirar a conta do titular", async () => {
    expect(await shareAccount(lucas.id, lucasAccount, householdId)).toMatchObject({ ok: true });
    expect(await shareAccount(karina.id, karinaAccount, householdId)).toMatchObject({ ok: true });

    expect(await totals(householdScope(householdId))).toEqual([1000, 2000]);
    expect(await totals(personalScope(lucas.id))).toEqual([1000]);
    expect(await db().$count(financialAccounts)).toBe(2);
  });

  it("só o titular compartilha, e só com residência da qual participa", async () => {
    expect(await shareAccount(karina.id, lucasAccount, householdId)).toMatchObject({ ok: false });
    const outra = await seedHousehold(db());
    expect(await shareAccount(lucas.id, lucasAccount, outra.household.id)).toMatchObject({ ok: false });
    expect(await shareAccount(lucas.id, "nao-e-uuid", householdId)).toMatchObject({ ok: false });
    expect(await totals(householdScope(householdId))).toEqual([]);
  });

  it("deixar de compartilhar devolve a conta ao espaço privado", async () => {
    await shareAccount(lucas.id, lucasAccount, householdId);
    expect(await shareAccount(lucas.id, lucasAccount, "")).toMatchObject({ ok: true });

    expect(await totals(householdScope(householdId))).toEqual([]);
    expect(await totals(personalScope(lucas.id))).toEqual([1000]);
  });

  it("uma conta fica em uma residência só: compartilhar em outra move", async () => {
    const outra = await seedHousehold(db());
    await shareAccount(lucas.id, lucasAccount, householdId);
    const { householdMemberships } = await import("@/db/schema");
    await db().insert(householdMemberships).values({ householdId: outra.household.id, memberId: lucas.id, role: "member" });

    await shareAccount(lucas.id, lucasAccount, outra.household.id);

    expect(await totals(householdScope(householdId))).toEqual([]);
    expect(await totals(householdScope(outra.household.id))).toEqual([1000]);
  });

  it("duas pessoas sem residência em comum não se enxergam", async () => {
    const outra = await seedHousehold(db());
    const estranha = await accountWithPurchase(outra.lucas.id, "Conta estranha", 7000);
    await shareAccount(outra.lucas.id, estranha, outra.household.id);

    expect(await totals(householdScope(householdId))).toEqual([]);
    expect(await totals(personalScope(lucas.id))).toEqual([1000]);
    expect((await listOwnAccounts(lucas.id)).map((a) => a.id)).toEqual([lucasAccount]);
  });

  it("registra o compartilhamento no histórico da residência", async () => {
    await shareAccount(lucas.id, lucasAccount, householdId);
    await shareAccount(lucas.id, lucasAccount, "");

    const changes = await listChanges(householdId, "compartilhamento");
    expect(changes.map((c) => c.kind).sort()).toEqual(["account_shared", "account_unshared"]);
  });
});
