import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/db/schema";

export async function createTestDatabase() {
  const client = new PGlite();
  await client.exec("create schema auth; create table auth.users (id uuid primary key, email text);");
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: "drizzle" });
  return db;
}

export async function seedHousehold(db: Awaited<ReturnType<typeof createTestDatabase>>) {
  const [household] = await db.insert(schema.households).values({ name: "Casa de teste" }).returning();
  const members = await db
    .insert(schema.householdMembers)
    .values([
      { householdId: household.id, displayName: "Lucas" },
      { householdId: household.id, displayName: "Karina" },
    ])
    .returning();
  await db.insert(schema.householdMemberships).values([
    { householdId: household.id, memberId: members[0].id, role: "admin" },
    { householdId: household.id, memberId: members[1].id, role: "member" },
  ]);
  return { household, lucas: members[0], karina: members[1] };
}

export async function shareWithMemberHousehold(
  db: Awaited<ReturnType<typeof createTestDatabase>>,
  accountId: string,
  memberId: string,
) {
  const [membership] = await db
    .select({ householdId: schema.householdMemberships.householdId })
    .from(schema.householdMemberships)
    .where(eq(schema.householdMemberships.memberId, memberId));
  if (membership) {
    await db
      .insert(schema.householdSharedAccounts)
      .values({ householdId: membership.householdId, accountId, sharedByMemberId: memberId });
  }
}
