import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { budgetAlerts, categories, financialAccounts, integrationConnections, transactions } from "@/db/schema";
import { createTestDatabase, seedHousehold } from "@/test/database";

const state = vi.hoisted(() => ({ db: undefined as unknown, send: undefined as unknown as ReturnType<typeof import("vitest").vi.fn> }));
vi.mock("@/db/client", () => ({ getDb: () => state.db }));
vi.mock("web-push", () => {
  state.send = vi.fn();
  return { sendNotification: state.send };
});

const { evaluateAndNotify, evaluateBudgetAlerts, saveGoal } = await import("./budget");
const { countMemberSubscriptions, dispatchBudgetPushes, removeSubscription, saveSubscription, vapidPublicKey } = await import("./push");

type TestDb = Awaited<ReturnType<typeof createTestDatabase>>;
const db = () => state.db as TestDb;
const send = () => state.send as unknown as ReturnType<typeof vi.fn>;

const NOW = new Date("2026-11-20T15:00:00-03:00");

let lucas: { memberId: string; householdId: string };
let karina: { memberId: string; householdId: string };
let outra: { memberId: string; householdId: string };
let card: string;
let category: Record<string, string>;
let sequence = 0;

const subscription = (name: string) => ({ endpoint: `https://push.example.com/${name}`, keys: { p256dh: `p-${name}`, auth: `a-${name}` } });

async function newCard(memberId: string) {
  sequence += 1;
  const [connection] = await db()
    .insert(integrationConnections)
    .values({ memberId, externalItemId: `item-${sequence}`, institutionName: "Banco" })
    .returning();
  const [account] = await db()
    .insert(financialAccounts)
    .values({ connectionId: connection.id, externalId: `cartao-${sequence}`, kind: "credit_card", name: "Cartão", currency: "BRL", balanceCents: 0 })
    .returning();
  return account.id;
}

async function spend(amountCents: number, slug = "restaurantes") {
  sequence += 1;
  await db()
    .insert(transactions)
    .values({
      accountId: card,
      externalId: `t${sequence}`,
      occurredAt: new Date("2026-11-10T12:00:00-03:00"),
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

const goal = { categoryId: "", expense: "", limit: "500", thresholds: "70, 90, 100" };

beforeEach(async () => {
  state.db = await createTestDatabase();
  send().mockReset();
  send().mockResolvedValue({ statusCode: 201 });
  vi.stubEnv("VAPID_PUBLIC_KEY", "pub");
  vi.stubEnv("VAPID_PRIVATE_KEY", "priv");
  vi.stubEnv("VAPID_SUBJECT", "mailto:casa@example.com");
  category = Object.fromEntries((await db().select().from(categories)).map((c) => [c.slug, c.id]));
  const seeded = await seedHousehold(db());
  lucas = { memberId: seeded.lucas.id, householdId: seeded.household.id };
  karina = { memberId: seeded.karina.id, householdId: seeded.household.id };
  card = await newCard(lucas.memberId);
  const other = await seedHousehold(db());
  outra = { memberId: other.lucas.id, householdId: other.household.id };
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("inscrições", () => {
  it("só expõe a chave pública quando o servidor está configurado", () => {
    expect(vapidPublicKey()).toBe("pub");
    vi.stubEnv("VAPID_PRIVATE_KEY", "");
    expect(vapidPublicKey()).toBeNull();
  });

  it("recusa inscrição sem configuração ou inválida", async () => {
    expect((await saveSubscription(lucas, { endpoint: "http://x", keys: {} })).ok).toBe(false);
    vi.stubEnv("VAPID_SUBJECT", "");
    expect(await saveSubscription(lucas, subscription("a"))).toEqual({
      ok: false,
      error: "As notificações ainda não foram configuradas no servidor.",
    });
    expect(await countMemberSubscriptions(lucas.memberId)).toBe(0);
  });

  it("salva, atualiza o dono do mesmo aparelho e remove só a própria", async () => {
    expect((await saveSubscription(lucas, subscription("a"))).ok).toBe(true);
    expect(await countMemberSubscriptions(lucas.memberId)).toBe(1);

    await saveSubscription(karina, subscription("a"));
    expect(await countMemberSubscriptions(lucas.memberId)).toBe(0);
    expect(await countMemberSubscriptions(karina.memberId)).toBe(1);

    await removeSubscription(lucas, subscription("a").endpoint);
    expect(await countMemberSubscriptions(karina.memberId)).toBe(1);
    await removeSubscription(karina, subscription("a").endpoint);
    expect(await countMemberSubscriptions(karina.memberId)).toBe(0);
  });
});

describe("envio dos avisos de meta", () => {
  it("manda um aviso por meta, com a maior faixa, para todos os aparelhos da casa", async () => {
    await saveSubscription(lucas, subscription("lucas"));
    await saveSubscription(karina, subscription("karina"));
    await saveSubscription(outra, subscription("outra"));
    await saveGoal(lucas, goal, NOW);
    await spend(60000);

    expect(await evaluateBudgetAlerts(lucas.householdId, NOW)).toBe(3);
    expect(await dispatchBudgetPushes(lucas.householdId, NOW)).toBe(2);

    const targets = send().mock.calls.map(([target]) => target.endpoint).sort();
    expect(targets).toEqual(["https://push.example.com/karina", "https://push.example.com/lucas"]);
    const payload = JSON.parse(send().mock.calls[0][1]);
    expect(payload.title).toBe("Todo o consumo: passou de 100% da meta");
    expect(payload.url).toBe("/metas");
    expect(payload.body.replace(/ /g, " ")).toBe("R$ 600,00 de R$ 500,00 em novembro de 2026");
  });

  it("não repete o aviso numa nova avaliação", async () => {
    await saveSubscription(lucas, subscription("lucas"));
    await saveGoal(lucas, goal, NOW);
    await spend(40000);

    await evaluateAndNotify(lucas.householdId, NOW);
    expect(send()).toHaveBeenCalledTimes(1);
    expect(JSON.parse(send().mock.calls[0][1]).title).toBe("Todo o consumo: chegou a 70% da meta");

    await evaluateAndNotify(lucas.householdId, NOW);
    expect(send()).toHaveBeenCalledTimes(1);

    await spend(7000);
    await evaluateAndNotify(lucas.householdId, NOW);
    expect(send()).toHaveBeenCalledTimes(2);
    expect(JSON.parse(send().mock.calls[1][1]).title).toBe("Todo o consumo: chegou a 90% da meta");
  });

  it("sem configuração não envia nem marca como enviado", async () => {
    await saveSubscription(lucas, subscription("lucas"));
    await saveGoal(lucas, goal, NOW);
    await spend(60000);
    await evaluateBudgetAlerts(lucas.householdId, NOW);
    vi.stubEnv("VAPID_PUBLIC_KEY", "");

    expect(await dispatchBudgetPushes(lucas.householdId, NOW)).toBe(0);
    expect(send()).not.toHaveBeenCalled();
    const alerts = await db().select().from(budgetAlerts);
    expect(alerts.every((alert) => alert.notifiedAt === null)).toBe(true);
  });

  it("marca avisos antigos como enviados sem notificar", async () => {
    await saveSubscription(lucas, subscription("lucas"));
    await saveGoal(lucas, goal, NOW);
    await spend(60000);
    await evaluateBudgetAlerts(lucas.householdId, NOW);

    const later = new Date("2026-11-25T15:00:00-03:00");
    expect(await dispatchBudgetPushes(lucas.householdId, later)).toBe(0);
    expect(send()).not.toHaveBeenCalled();
    const alerts = await db().select().from(budgetAlerts);
    expect(alerts.every((alert) => alert.notifiedAt !== null)).toBe(true);
  });

  it("remove o aparelho expirado e mantém o que falhou por outro motivo", async () => {
    await saveSubscription(lucas, subscription("morto"));
    await saveSubscription(karina, subscription("instavel"));
    await saveGoal(lucas, goal, NOW);
    await spend(60000);
    send().mockImplementation(async (target: { endpoint: string }) => {
      throw Object.assign(new Error("falha"), { statusCode: target.endpoint.endsWith("morto") ? 410 : 500 });
    });
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await evaluateAndNotify(lucas.householdId, NOW);

    expect(await countMemberSubscriptions(lucas.memberId)).toBe(0);
    expect(await countMemberSubscriptions(karina.memberId)).toBe(1);
    errors.mockRestore();
  });

  it("uma falha no envio não derruba a avaliação nem o salvamento da meta", async () => {
    await saveSubscription(lucas, subscription("lucas"));
    await spend(60000);
    send().mockRejectedValue(new Error("fora do ar"));
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await saveGoal(lucas, goal, NOW);

    expect(result.ok).toBe(true);
    expect((await db().select().from(budgetAlerts)).length).toBe(3);
    errors.mockRestore();
  });
});
