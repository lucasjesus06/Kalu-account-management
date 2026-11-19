import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { authUsers } from "drizzle-orm/supabase";

export const households = pgTable("households", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

export const householdMembers = pgTable(
  "household_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "restrict" }),
    displayName: text("display_name").notNull(),
    userId: uuid("user_id")
      .unique()
      .references(() => authUsers.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("household_members_household_id_idx").on(table.householdId)],
).enableRLS();

export const pluggyCredentials = pgTable("pluggy_credentials", {
  memberId: uuid("member_id")
    .primaryKey()
    .references(() => householdMembers.id, { onDelete: "cascade" }),
  clientId: text("client_id").notNull(),
  clientSecretEncrypted: text("client_secret_encrypted").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

export const connectionStatuses = ["active", "expired", "revoked", "error"] as const;

export const integrationConnections = pgTable(
  "integration_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => householdMembers.id, { onDelete: "restrict" }),
    provider: text("provider").notNull().default("pluggy"),
    externalItemId: text("external_item_id").notNull(),
    institutionName: text("institution_name"),
    status: text("status", { enum: connectionStatuses }).notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("integration_connections_provider_item_idx").on(table.provider, table.externalItemId),
    index("integration_connections_member_id_idx").on(table.memberId),
  ],
).enableRLS();
