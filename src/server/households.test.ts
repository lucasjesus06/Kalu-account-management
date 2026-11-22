import { beforeEach, describe, expect, it, vi } from "vitest";
import { financialAccounts, householdInvites, householdMembers, householdMemberships, households, integrationConnections } from "@/db/schema";
import { householdScope, personalScope } from "@/domain/scope";
import { createTestDatabase, seedHousehold } from "@/test/database";

const state = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("@/db/client", () => ({ getDb: () => state.db, getServiceDb: () => state.db, asService: <T>(work: () => Promise<T>) => work() }));

const { acceptInvite, createHousehold, createInvite, getInvitePreview, leaveHousehold, listManagedHouseholds, removeMember, revokeInvite, transferAdmin } =
  await import("./households");
const { shareAccount } = await import("./sharing");
const { listAccounts } = await import("./accounts");
const { listHouseholdLinks } = await import("./profiles");
const { listChanges } = await import("./change-log");

type TestDb = Awaited<ReturnType<typeof createTestDatabase>>;
const db = () => state.db as TestDb;

const NOW = new Date("2026-11-22T12:00:00Z");
let lucas: { id: string };
let karina: { id: string };
let householdId: string;

async function person(displayName: string) {
  const [row] = await db().insert(householdMembers).values({ displayName }).returning();
  return row;
}

async function account(memberId: string, name: string) {
  const [connection] = await db()
    .insert(integrationConnections)
    .values({ memberId, externalItemId: `item-${name}`, institutionName: "Banco" })
    .returning();
  const [row] = await db()
    .insert(financialAccounts)
    .values({ connectionId: connection.id, externalId: name, kind: "checking", name, currency: "BRL", balanceCents: 0 })
    .returning();
  return row.id;
}

async function invite(adminId = lucas.id, id = householdId) {
  const result = await createInvite(adminId, id, NOW);
  if (!result.ok) throw new Error(result.error);
  return result.token;
}

beforeEach(async () => {
  state.db = await createTestDatabase();
  const seeded = await seedHousehold(db());
  lucas = seeded.lucas;
  karina = seeded.karina;
  householdId = seeded.household.id;
});

describe("criar residência", () => {
  it("quem cria vira o administrador, sem precisar de outra residência", async () => {
    const ana = await person("Ana");
    const result = await createHousehold(ana.id, "  Casa da Ana ");
    expect(result.ok).toBe(true);
    expect(await listHouseholdLinks(ana.id)).toMatchObject([{ householdName: "Casa da Ana", role: "admin" }]);
  });

  it("recusa nome vazio", async () => {
    const ana = await person("Ana");
    expect(await createHousehold(ana.id, "  ")).toMatchObject({ ok: false });
    expect(await listHouseholdLinks(ana.id)).toEqual([]);
  });

  it("uma pessoa pode ter várias residências, com um administrador cada", async () => {
    await createHousehold(lucas.id, "Casa da praia");
    expect((await listHouseholdLinks(lucas.id)).map((l) => l.role)).toEqual(["admin", "admin"]);
  });
});

describe("convite por link", () => {
  it("só o administrador convida", async () => {
    expect(await createInvite(karina.id, householdId, NOW)).toMatchObject({ ok: false });
    expect(await createInvite(lucas.id, householdId, NOW)).toMatchObject({ ok: true });
  });

  it("entrar não transfere dados nem dá acesso às contas de ninguém", async () => {
    const ana = await person("Ana");
    const anaAccount = await account(ana.id, "Conta Ana");
    const lucasAccount = await account(lucas.id, "Conta Lucas");
    await shareAccount(lucas.id, lucasAccount, householdId);

    expect(await acceptInvite(ana.id, await invite(), NOW)).toMatchObject({ ok: true });

    expect(await listHouseholdLinks(ana.id)).toHaveLength(1);
    expect((await listAccounts(personalScope(ana.id))).map((a) => a.id)).toEqual([anaAccount]);
    expect((await listAccounts(householdScope(householdId))).map((a) => a.id)).toEqual([lucasAccount]);
    expect(await shareAccount(ana.id, lucasAccount, householdId)).toMatchObject({ ok: false });
    expect(await db().$count(financialAccounts)).toBe(2);
  });

  it("o convite é de uso único", async () => {
    const token = await invite();
    const ana = await person("Ana");
    const beto = await person("Beto");
    expect(await acceptInvite(ana.id, token, NOW)).toMatchObject({ ok: true });
    expect(await acceptInvite(beto.id, token, NOW)).toMatchObject({ ok: false, error: expect.stringContaining("já foi usado") });
  });

  it("recusa convite expirado, cancelado ou inexistente", async () => {
    const ana = await person("Ana");
    const expired = await invite();
    const later = new Date(NOW.getTime() + 8 * 24 * 60 * 60 * 1000);
    expect(await acceptInvite(ana.id, expired, later)).toMatchObject({ ok: false, error: expect.stringContaining("expirou") });

    const cancelled = await invite();
    const [row] = await db().select().from(householdInvites);
    const all = await db().select().from(householdInvites);
    const target = all.find((i) => i.id !== row.id) ?? row;
    expect(await revokeInvite(lucas.id, target.id)).toMatchObject({ ok: true });
    expect(await acceptInvite(ana.id, cancelled, NOW)).toMatchObject({ ok: false });
    expect(await acceptInvite(ana.id, "token-que-nao-existe", NOW)).toMatchObject({ ok: false });
    expect(await listHouseholdLinks(ana.id)).toEqual([]);
  });

  it("quem já participa não entra de novo e o convite não é gasto", async () => {
    const token = await invite();
    expect(await acceptInvite(karina.id, token, NOW)).toMatchObject({ ok: false });
    const ana = await person("Ana");
    expect(await acceptInvite(ana.id, token, NOW)).toMatchObject({ ok: true });
  });

  it("só o administrador cancela convites", async () => {
    await invite();
    const [row] = await db().select().from(householdInvites);
    expect(await revokeInvite(karina.id, row.id)).toMatchObject({ ok: false });
  });

  it("a prévia mostra a residência e o estado, e o token não fica guardado em claro", async () => {
    const token = await invite();
    expect(await getInvitePreview(token, NOW)).toMatchObject({ householdName: "Casa de teste", inviterName: "Lucas", status: "usable" });
    expect(await getInvitePreview("outro", NOW)).toBeNull();
    const [row] = await db().select().from(householdInvites);
    expect(row.tokenHash).not.toContain(token);
  });

  it("uma pessoa entra em várias residências e cada uma enxerga só o que foi compartilhado nela", async () => {
    const ana = await person("Ana");
    const casaAna = await createHousehold(ana.id, "Casa da Ana");
    if (!casaAna.ok) throw new Error();
    await acceptInvite(lucas.id, await invite(ana.id, casaAna.householdId), NOW);
    const lucasAccount = await account(lucas.id, "Conta Lucas");
    await shareAccount(lucas.id, lucasAccount, casaAna.householdId);

    expect((await listHouseholdLinks(lucas.id)).map((l) => l.householdName).sort()).toEqual(["Casa da Ana", "Casa de teste"]);
    expect((await listAccounts(householdScope(casaAna.householdId))).map((a) => a.id)).toEqual([lucasAccount]);
    expect(await listAccounts(householdScope(householdId))).toEqual([]);
  });

  it("registra a entrada no histórico", async () => {
    const ana = await person("Ana");
    await acceptInvite(ana.id, await invite(), NOW);
    expect((await listChanges(householdId, "integrantes")).map((c) => [c.kind, c.subject])).toEqual([["member_joined", "Ana"]]);
  });
});

describe("sair, remover e transferir", () => {
  it("quem sai leva as contas compartilhadas de volta para o espaço privado, sem perdê-las", async () => {
    const karinaAccount = await account(karina.id, "Conta Karina");
    await shareAccount(karina.id, karinaAccount, householdId);

    expect(await leaveHousehold(karina.id, householdId)).toMatchObject({ ok: true, closed: false });

    expect(await listAccounts(householdScope(householdId))).toEqual([]);
    expect((await listAccounts(personalScope(karina.id))).map((a) => a.id)).toEqual([karinaAccount]);
    expect(await listHouseholdLinks(karina.id)).toEqual([]);
    expect((await listChanges(householdId, "integrantes")).map((c) => c.kind)).toEqual(["member_left"]);
  });

  it("o administrador precisa transferir antes de sair", async () => {
    expect(await leaveHousehold(lucas.id, householdId)).toMatchObject({ ok: false });
    expect(await transferAdmin(lucas.id, householdId, karina.id)).toMatchObject({ ok: true });
    expect(await leaveHousehold(lucas.id, householdId)).toMatchObject({ ok: true });
    expect(await listHouseholdLinks(karina.id)).toMatchObject([{ role: "admin" }]);
  });

  it("o último integrante encerra a residência sem apagar as contas de ninguém", async () => {
    const lucasAccount = await account(lucas.id, "Conta Lucas");
    await shareAccount(lucas.id, lucasAccount, householdId);
    await leaveHousehold(karina.id, householdId);

    expect(await leaveHousehold(lucas.id, householdId)).toMatchObject({ ok: true, closed: true });

    expect(await db().$count(households)).toBe(0);
    expect(await db().$count(householdMemberships)).toBe(0);
    expect((await listAccounts(personalScope(lucas.id))).map((a) => a.id)).toEqual([lucasAccount]);
  });

  it("o administrador remove integrantes, mas não a si mesmo nem quem é de fora", async () => {
    const lucasAccount = await account(karina.id, "Conta Karina");
    await shareAccount(karina.id, lucasAccount, householdId);
    const ana = await person("Ana");

    expect(await removeMember(karina.id, householdId, lucas.id)).toMatchObject({ ok: false });
    expect(await removeMember(lucas.id, householdId, lucas.id)).toMatchObject({ ok: false });
    expect(await removeMember(lucas.id, householdId, ana.id)).toMatchObject({ ok: false });
    expect(await removeMember(lucas.id, householdId, karina.id)).toMatchObject({ ok: true });

    expect(await listAccounts(householdScope(householdId))).toEqual([]);
    expect(await db().$count(financialAccounts)).toBe(1);
    expect((await listChanges(householdId, "integrantes")).map((c) => c.kind)).toEqual(["member_removed"]);
  });

  it("só o administrador transfere, e só para um integrante", async () => {
    const ana = await person("Ana");
    expect(await transferAdmin(karina.id, householdId, karina.id)).toMatchObject({ ok: false });
    expect(await transferAdmin(lucas.id, householdId, lucas.id)).toMatchObject({ ok: false });
    expect(await transferAdmin(lucas.id, householdId, ana.id)).toMatchObject({ ok: false });
    expect(await transferAdmin(lucas.id, householdId, karina.id)).toMatchObject({ ok: true });
    expect((await listManagedHouseholds(lucas.id, NOW))[0]).toMatchObject({ role: "member", invites: [] });
  });

  it("não presume parentesco: qualquer integrante pode ser promovido", async () => {
    const ana = await person("Ana");
    await acceptInvite(ana.id, await invite(), NOW);
    expect(await transferAdmin(lucas.id, householdId, ana.id)).toMatchObject({ ok: true });
    expect((await listManagedHouseholds(ana.id, NOW))[0].members.map((m) => m.role).sort()).toEqual(["admin", "member", "member"]);
  });
});
