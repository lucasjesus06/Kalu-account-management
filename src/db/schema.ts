import { bigint, date, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
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
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    authorizationExpiresAt: timestamp("authorization_expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("integration_connections_provider_item_idx").on(table.provider, table.externalItemId),
    index("integration_connections_member_id_idx").on(table.memberId),
  ],
).enableRLS();

const cents = (name: string) => bigint(name, { mode: "number" });

export const accountKinds = ["checking", "savings", "credit_card", "other"] as const;

export const financialAccounts = pgTable(
  "financial_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => integrationConnections.id, { onDelete: "restrict" }),
    externalId: text("external_id").notNull(),
    kind: text("kind", { enum: accountKinds }).notNull(),
    name: text("name").notNull(),
    numberLast4: text("number_last4"),
    currency: text("currency").notNull(),
    balanceCents: cents("balance_cents").notNull(),
    creditLimitCents: cents("credit_limit_cents"),
    creditAvailableCents: cents("credit_available_cents"),
    creditUsedCents: cents("credit_used_cents"),
    cardBrand: text("card_brand"),
    lastBillDueDate: date("last_bill_due_date"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("financial_accounts_connection_external_idx").on(table.connectionId, table.externalId)],
).enableRLS();

export const creditCardBills = pgTable(
  "credit_card_bills",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => financialAccounts.id, { onDelete: "restrict" }),
    externalId: text("external_id").notNull(),
    dueDate: date("due_date").notNull(),
    totalCents: cents("total_cents").notNull(),
    minimumPaymentCents: cents("minimum_payment_cents"),
    currency: text("currency").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("credit_card_bills_account_external_idx").on(table.accountId, table.externalId)],
).enableRLS();

export const categories = pgTable("categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

export const categorySources = ["automatic", "rule", "user"] as const;

export const transactionDirections = ["outflow", "inflow"] as const;
export const transactionStatuses = ["posted", "pending"] as const;

export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => financialAccounts.id, { onDelete: "restrict" }),
    externalId: text("external_id").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    description: text("description").notNull(),
    amountCents: cents("amount_cents").notNull(),
    direction: text("direction", { enum: transactionDirections }).notNull(),
    status: text("status", { enum: transactionStatuses }).notNull(),
    currency: text("currency").notNull(),
    billId: uuid("bill_id").references(() => creditCardBills.id, { onDelete: "set null" }),
    billExternalId: text("bill_external_id"),
    installmentNumber: integer("installment_number"),
    installmentTotal: integer("installment_total"),
    providerCategory: text("provider_category"),
    merchantName: text("merchant_name"),
    categoryId: uuid("category_id").references(() => categories.id, { onDelete: "set null" }),
    categorySource: text("category_source", { enum: categorySources }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("transactions_account_external_idx").on(table.accountId, table.externalId),
    index("transactions_account_occurred_idx").on(table.accountId, table.occurredAt),
    index("transactions_bill_idx").on(table.billId),
    index("transactions_category_idx").on(table.categoryId),
  ],
).enableRLS();

export const syncStatuses = ["running", "succeeded", "failed"] as const;

export const syncRuns = pgTable(
  "sync_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => integrationConnections.id, { onDelete: "cascade" }),
    status: text("status", { enum: syncStatuses }).notNull().default("running"),
    accountsCount: integer("accounts_count").notNull().default(0),
    billsCount: integer("bills_count").notNull().default(0),
    transactionsCount: integer("transactions_count").notNull().default(0),
    transactionsCreated: integer("transactions_created").notNull().default(0),
    transactionsUpdated: integer("transactions_updated").notNull().default(0),
    transactionsRemoved: integer("transactions_removed").notNull().default(0),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    index("sync_runs_connection_started_idx").on(table.connectionId, table.startedAt),
    uniqueIndex("sync_runs_one_running_per_connection_idx")
      .on(table.connectionId)
      .where(sql`${table.status} = 'running'`),
  ],
).enableRLS();
