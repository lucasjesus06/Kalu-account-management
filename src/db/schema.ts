import { bigint, check, date, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { authUsers } from "drizzle-orm/supabase";
import { changeKinds, changeScopes } from "../domain/change-log";
import { householdRoles } from "../domain/household";
import { expenseNatureSources, expenseNatures } from "../domain/expense-nature";

export const households = pgTable("households", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

export const householdMembers = pgTable(
  "household_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: uuid("household_id").references(() => households.id, { onDelete: "restrict" }),
    displayName: text("display_name").notNull(),
    userId: uuid("user_id")
      .unique()
      .references(() => authUsers.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("household_members_household_id_idx").on(table.householdId)],
).enableRLS();

export const householdMemberships = pgTable(
  "household_memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    memberId: uuid("member_id")
      .notNull()
      .references(() => householdMembers.id, { onDelete: "cascade" }),
    role: text("role", { enum: householdRoles }).notNull().default("member"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("household_memberships_household_member_idx").on(table.householdId, table.memberId),
    uniqueIndex("household_memberships_one_admin_idx")
      .on(table.householdId)
      .where(sql`${table.role} = 'admin'`),
    index("household_memberships_member_idx").on(table.memberId),
  ],
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
  kind: text("kind", { enum: ["expense", "transfer"] }).notNull().default("expense"),
  sortOrder: integer("sort_order").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

export const categoryRules = pgTable(
  "category_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: uuid("household_id").references(() => households.id, { onDelete: "cascade" }),
    ownerMemberId: uuid("owner_member_id").references(() => householdMembers.id, { onDelete: "cascade" }),
    merchantName: text("merchant_name").notNull(),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
    createdByMemberId: uuid("created_by_member_id").references(() => householdMembers.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("category_rules_household_merchant_idx").on(table.householdId, table.merchantName),
    uniqueIndex("category_rules_owner_merchant_idx").on(table.ownerMemberId, table.merchantName),
    check(
      "category_rules_owner_check",
      sql`(${table.householdId} is not null)::int + (${table.ownerMemberId} is not null)::int = 1`,
    ),
  ],
).enableRLS();

export const expenseNatureRules = pgTable(
  "expense_nature_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    merchantName: text("merchant_name").notNull(),
    expenseNature: text("expense_nature", { enum: expenseNatures }).notNull(),
    expenseMemberId: uuid("expense_member_id").references(() => householdMembers.id, { onDelete: "cascade" }),
    createdByMemberId: uuid("created_by_member_id").references(() => householdMembers.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("expense_nature_rules_household_merchant_idx").on(table.householdId, table.merchantName),
    check(
      "expense_nature_rules_member_check",
      sql`case when ${table.expenseNature} = 'individual' then ${table.expenseMemberId} is not null else ${table.expenseMemberId} is null end`,
    ),
  ],
).enableRLS();

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
    expenseNature: text("expense_nature", { enum: expenseNatures }),
    expenseMemberId: uuid("expense_member_id").references(() => householdMembers.id, { onDelete: "restrict" }),
    expenseNatureSource: text("expense_nature_source", { enum: expenseNatureSources }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("transactions_account_external_idx").on(table.accountId, table.externalId),
    index("transactions_account_occurred_idx").on(table.accountId, table.occurredAt),
    index("transactions_bill_idx").on(table.billId),
    index("transactions_category_idx").on(table.categoryId),
    check(
      "transactions_expense_member_check",
      sql`case when ${table.expenseNature} = 'individual' then ${table.expenseMemberId} is not null else ${table.expenseMemberId} is null end`,
    ),
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

export const webhookEventResults = ["synced", "revoked", "ignored", "failed"] as const;

export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider").notNull().default("pluggy"),
    externalEventId: text("external_event_id").notNull(),
    event: text("event").notNull(),
    externalItemId: text("external_item_id"),
    connectionId: uuid("connection_id").references(() => integrationConnections.id, { onDelete: "set null" }),
    triggeredBy: text("triggered_by"),
    result: text("result", { enum: webhookEventResults }),
    detail: text("detail"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("webhook_events_provider_event_idx").on(table.provider, table.externalEventId),
    index("webhook_events_connection_idx").on(table.connectionId, table.receivedAt),
  ],
).enableRLS();

export const budgetGoals = pgTable(
  "budget_goals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id").references(() => categories.id, { onDelete: "restrict" }),
    expenseNature: text("expense_nature", { enum: expenseNatures }),
    expenseMemberId: uuid("expense_member_id").references(() => householdMembers.id, { onDelete: "restrict" }),
    limitCents: cents("limit_cents").notNull(),
    alertThresholds: integer("alert_thresholds")
      .array()
      .notNull()
      .default(sql`'{70,90,100}'`),
    startsMonth: text("starts_month").notNull(),
    endsMonth: text("ends_month"),
    createdByMemberId: uuid("created_by_member_id").references(() => householdMembers.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("budget_goals_household_idx").on(table.householdId),
    check("budget_goals_limit_check", sql`${table.limitCents} > 0`),
    check(
      "budget_goals_months_check",
      sql`${table.startsMonth} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' and (${table.endsMonth} is null or (${table.endsMonth} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' and ${table.endsMonth} >= ${table.startsMonth}))`,
    ),
    check(
      "budget_goals_member_check",
      sql`case when ${table.expenseNature} = 'individual' then ${table.expenseMemberId} is not null else ${table.expenseMemberId} is null end`,
    ),
  ],
).enableRLS();

export const budgetAlerts = pgTable(
  "budget_alerts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    goalId: uuid("goal_id")
      .notNull()
      .references(() => budgetGoals.id, { onDelete: "cascade" }),
    month: text("month").notNull(),
    threshold: integer("threshold").notNull(),
    consumedCents: cents("consumed_cents").notNull(),
    limitCents: cents("limit_cents").notNull(),
    triggeredAt: timestamp("triggered_at", { withTimezone: true }).notNull().defaultNow(),
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
  },
  (table) => [uniqueIndex("budget_alerts_goal_month_threshold_idx").on(table.goalId, table.month, table.threshold)],
).enableRLS();


export const changeLog = pgTable(
  "change_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    memberId: uuid("member_id").references(() => householdMembers.id, { onDelete: "set null" }),
    kind: text("kind", { enum: changeKinds }).notNull(),
    subject: text("subject").notNull(),
    scope: text("scope", { enum: changeScopes }),
    previousValue: text("previous_value"),
    newValue: text("new_value"),
    affectedCount: integer("affected_count").notNull().default(1),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("change_log_household_occurred_idx").on(table.householdId, table.occurredAt)],
).enableRLS();

export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => householdMembers.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("push_subscriptions_endpoint_idx").on(table.endpoint),
    index("push_subscriptions_member_idx").on(table.memberId),
  ],
).enableRLS();

export const householdSharedAccounts = pgTable(
  "household_shared_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => financialAccounts.id, { onDelete: "cascade" }),
    sharedByMemberId: uuid("shared_by_member_id")
      .notNull()
      .references(() => householdMembers.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("household_shared_accounts_account_idx").on(table.accountId),
    index("household_shared_accounts_household_idx").on(table.householdId),
  ],
).enableRLS();

export const householdInvites = pgTable(
  "household_invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    createdByMemberId: uuid("created_by_member_id")
      .notNull()
      .references(() => householdMembers.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    usedByMemberId: uuid("used_by_member_id").references(() => householdMembers.id, { onDelete: "set null" }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("household_invites_token_hash_idx").on(table.tokenHash),
    index("household_invites_household_idx").on(table.householdId),
  ],
).enableRLS();
