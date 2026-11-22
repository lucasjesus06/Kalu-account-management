import { readFileSync } from "node:fs";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { householdMembers, householdMemberships, households } from "@/db/schema";
import { createTestDatabase, seedHousehold } from "@/test/database";

const state = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("@/db/client", () => ({ getDb: () => state.db }));

const { ensureProfile, listHouseholdLinks } = await import("./profiles");

type TestDb = Awaited<ReturnType<typeof createTestDatabase>>;
const db = () => state.db as TestDb;

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";

async function authUser(id: string) {
  await db().execute(sql`insert into auth.users (id, email) values (${id}, ${`${id}@x.com`})`);
}

beforeEach(async () => {
  state.db = await createTestDatabase();
  await authUser(USER_A);
  await authUser(USER_B);
});

describe("perfil pessoal", () => {
  it("existe sem residência e sem participação em nenhuma", async () => {
    const profile = await ensureProfile(USER_A, "Ana");

    expect(profile.displayName).toBe("Ana");
    expect(await listHouseholdLinks(profile.memberId)).toEqual([]);
    const [row] = await db().select().from(householdMembers).where(eq(householdMembers.id, profile.memberId));
    expect(row.householdId).toBeNull();
  });

  it("é criado uma vez só por usuário e mantém o nome já existente", async () => {
    const first = await ensureProfile(USER_A, "Ana");
    const second = await ensureProfile(USER_A, "Outro nome");

    expect(second).toEqual(first);
    expect(await db().$count(householdMembers)).toBe(1);
  });

  it("aguenta chamadas simultâneas do mesmo usuário", async () => {
    const results = await Promise.all([ensureProfile(USER_A, "Ana"), ensureProfile(USER_A, "Ana"), ensureProfile(USER_A, "Ana")]);

    expect(new Set(results.map((r) => r.memberId)).size).toBe(1);
    expect(await db().$count(householdMembers)).toBe(1);
  });

  it("dois usuários têm perfis independentes", async () => {
    const a = await ensureProfile(USER_A, "Ana");
    const b = await ensureProfile(USER_B, "Bruno");

    expect(a.memberId).not.toBe(b.memberId);
    expect(await listHouseholdLinks(a.memberId)).toEqual([]);
    expect(await listHouseholdLinks(b.memberId)).toEqual([]);
  });
});

describe("participação em residências", () => {
  it("um perfil participa de mais de uma residência, com papéis diferentes", async () => {
    const lucas = (await seedHousehold(db())).lucas;
    const [outra] = await db().insert(households).values({ name: "República" }).returning();
    await db().insert(householdMemberships).values({ householdId: outra.id, memberId: lucas.id, role: "member" });

    const links = await listHouseholdLinks(lucas.id);

    expect(links.map((l) => [l.householdName, l.role])).toEqual([
      ["Casa de teste", "admin"],
      ["República", "member"],
    ]);
  });

  it("participar não altera a titularidade nem cria dados no perfil", async () => {
    const profile = await ensureProfile(USER_A, "Ana");
    const [casa] = await db().insert(households).values({ name: "Casa" }).returning();
    await db().insert(householdMemberships).values({ householdId: casa.id, memberId: profile.memberId, role: "admin" });

    const [row] = await db().select().from(householdMembers).where(eq(householdMembers.id, profile.memberId));
    expect(row.id).toBe(profile.memberId);
    expect(row.userId).toBe(USER_A);
  });

  it("não aceita dois administradores nem a mesma pessoa duas vezes na residência", async () => {
    const seeded = await seedHousehold(db());

    await expect(
      db().update(householdMemberships).set({ role: "admin" }).where(eq(householdMemberships.memberId, seeded.karina.id)),
    ).rejects.toThrow();
    await expect(
      db().insert(householdMemberships).values({ householdId: seeded.household.id, memberId: seeded.lucas.id, role: "member" }),
    ).rejects.toThrow();
  });

  it("uma residência pode ter integrantes sem relação de parentesco ou casamento, e só um admin", async () => {
    const [casa] = await db().insert(households).values({ name: "República" }).returning();
    const people = await db()
      .insert(householdMembers)
      .values([{ displayName: "A" }, { displayName: "B" }, { displayName: "C" }])
      .returning();
    await db()
      .insert(householdMemberships)
      .values(people.map((p, index) => ({ householdId: casa.id, memberId: p.id, role: index === 0 ? ("admin" as const) : ("member" as const) })));

    expect(await db().$count(householdMemberships, eq(householdMemberships.householdId, casa.id))).toBe(3);
  });

  it("apagar a residência remove as participações e preserva o perfil", async () => {
    const seeded = await seedHousehold(db());
    await db().update(householdMembers).set({ householdId: null }).where(eq(householdMembers.householdId, seeded.household.id));

    await db().delete(households).where(eq(households.id, seeded.household.id));

    expect(await db().$count(householdMemberships)).toBe(0);
    expect(await db().$count(householdMembers)).toBe(2);
  });
});

describe("migration 0018", () => {
  async function backfill() {
    const file = readMigration();
    const statement = file.split("--> statement-breakpoint").find((part) => part.includes("INSERT INTO \"household_memberships\""))!;
    await db().execute(sql.raw(statement));
  }

  it("cria uma participação por integrante existente, com o mais antigo como administrador", async () => {
    const [casa] = await db().insert(households).values({ name: "Nossa casa" }).returning();
    const [outra] = await db().insert(households).values({ name: "Outra" }).returning();
    const rows = await db()
      .insert(householdMembers)
      .values([
        { householdId: casa.id, displayName: "Karina", createdAt: new Date("2026-02-01T00:00:00Z") },
        { householdId: casa.id, displayName: "Lucas", createdAt: new Date("2026-01-01T00:00:00Z") },
        { householdId: outra.id, displayName: "Solo", createdAt: new Date("2026-03-01T00:00:00Z") },
        { displayName: "Sem casa" },
      ])
      .returning();
    const byName = Object.fromEntries(rows.map((r) => [r.displayName, r.id]));

    await backfill();

    const memberships = await db().select().from(householdMemberships);
    expect(memberships).toHaveLength(3);
    const roleOf = (name: string) => memberships.find((m) => m.memberId === byName[name])?.role;
    expect(roleOf("Lucas")).toBe("admin");
    expect(roleOf("Karina")).toBe("member");
    expect(roleOf("Solo")).toBe("admin");
    expect(roleOf("Sem casa")).toBeUndefined();
  });
});

function readMigration() {
  return readFileSync("drizzle/0018_perfil_e_participacao_em_residencias.sql", "utf8");
}
