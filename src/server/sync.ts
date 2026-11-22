import "server-only";
import { and, asc, desc, eq, inArray, isNull, lt, ne, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import {
  categories,
  categoryRules,
  creditCardBills,
  financialAccounts,
  householdMembers,
  integrationConnections,
  pluggyCredentials,
  syncRuns,
  transactions,
} from "@/db/schema";
import { categorize } from "@/domain/categorization";
import { detectChanges, hasChanged } from "@/domain/changes";
import { merchantName } from "@/domain/merchant";
import type { ImportedAccount, ImportedBill, ImportedTransaction } from "@/domain/imported";
import {
  authenticate,
  getItem,
  listAccounts,
  listBills,
  listTransactions,
  PluggyAuthError,
  PluggyNotFoundError,
} from "@/integrations/pluggy/client";
import { decrypt } from "./crypto";

export type SyncResult =
  | { ok: true; accounts: number; bills: number; transactions: number; changes: TransactionChanges }
  | { ok: false; error: string };

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const CHUNK_SIZE = 500;
const STALE_RUN_MINUTES = 15;

class SyncError extends Error {}

class AuthorizationExpiredError extends Error {}

class EmptySourceError extends Error {}

const EXPIRED_ERROR_CODES = new Set(["USER_AUTHORIZATION_EXPIRED", "USER_AUTHORIZATION_REVOKED"]);

function chunk<T>(items: T[]) {
  const chunks: T[][] = [];
  for (let start = 0; start < items.length; start += CHUNK_SIZE) {
    chunks.push(items.slice(start, start + CHUNK_SIZE));
  }
  return chunks;
}

const excluded = (column: string) => sql.raw(`excluded.${column}`);

export type TransactionChanges = { created: number; updated: number; removed: number };

const accountFields = {
  kind: financialAccounts.kind,
  name: financialAccounts.name,
  numberLast4: financialAccounts.numberLast4,
  currency: financialAccounts.currency,
  balanceCents: financialAccounts.balanceCents,
  creditLimitCents: financialAccounts.creditLimitCents,
  creditAvailableCents: financialAccounts.creditAvailableCents,
  creditUsedCents: financialAccounts.creditUsedCents,
  cardBrand: financialAccounts.cardBrand,
  lastBillDueDate: financialAccounts.lastBillDueDate,
};

async function saveAccount(tx: Tx, connectionId: string, account: ImportedAccount) {
  const values = {
    kind: account.kind,
    name: account.name,
    numberLast4: account.numberLast4,
    currency: account.currency,
    balanceCents: account.balanceCents,
    creditLimitCents: account.credit?.limitCents ?? null,
    creditAvailableCents: account.credit?.availableCents ?? null,
    creditUsedCents: account.credit?.usedCents ?? null,
    cardBrand: account.credit?.brand ?? null,
    lastBillDueDate: account.credit?.lastBillDueDate ?? null,
  };

  const [stored] = await tx
    .select({ id: financialAccounts.id, ...accountFields })
    .from(financialAccounts)
    .where(and(eq(financialAccounts.connectionId, connectionId), eq(financialAccounts.externalId, account.externalId)));

  if (!stored) {
    const [created] = await tx
      .insert(financialAccounts)
      .values({ connectionId, externalId: account.externalId, ...values })
      .returning({ id: financialAccounts.id });
    return created.id;
  }

  if (hasChanged(values, stored)) {
    await tx
      .update(financialAccounts)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(financialAccounts.id, stored.id));
  }
  return stored.id;
}

const billFields = {
  externalId: creditCardBills.externalId,
  dueDate: creditCardBills.dueDate,
  totalCents: creditCardBills.totalCents,
  minimumPaymentCents: creditCardBills.minimumPaymentCents,
  currency: creditCardBills.currency,
};

async function saveBills(tx: Tx, accountId: string, bills: ImportedBill[]) {
  const stored = await tx
    .select({ id: creditCardBills.id, ...billFields })
    .from(creditCardBills)
    .where(eq(creditCardBills.accountId, accountId));
  const billIds = new Map(stored.map((row) => [row.externalId, row.id]));

  const incoming = bills.map((bill) => ({
    externalId: bill.externalId,
    dueDate: bill.dueDate,
    totalCents: bill.totalCents,
    minimumPaymentCents: bill.minimumPaymentCents,
    currency: bill.currency,
  }));
  const { created, updated } = detectChanges(
    incoming,
    new Map(stored.map((row) => [row.externalId, row])),
    (bill) => bill.externalId,
  );

  for (const batch of chunk([...created, ...updated])) {
    const written = await tx
      .insert(creditCardBills)
      .values(batch.map((bill) => ({ accountId, ...bill })))
      .onConflictDoUpdate({
        target: [creditCardBills.accountId, creditCardBills.externalId],
        set: {
          dueDate: excluded("due_date"),
          totalCents: excluded("total_cents"),
          minimumPaymentCents: excluded("minimum_payment_cents"),
          currency: excluded("currency"),
          updatedAt: new Date(),
        },
      })
      .returning({ id: creditCardBills.id, externalId: creditCardBills.externalId });
    written.forEach((row) => billIds.set(row.externalId, row.id));
  }

  return billIds;
}

const transactionFields = {
  externalId: transactions.externalId,
  occurredAt: transactions.occurredAt,
  description: transactions.description,
  amountCents: transactions.amountCents,
  direction: transactions.direction,
  status: transactions.status,
  currency: transactions.currency,
  billId: transactions.billId,
  billExternalId: transactions.billExternalId,
  installmentNumber: transactions.installmentNumber,
  installmentTotal: transactions.installmentTotal,
  providerCategory: transactions.providerCategory,
};

async function saveTransactions(
  tx: Tx,
  accountId: string,
  imported: ImportedTransaction[],
  billIds: Map<string, string>,
): Promise<TransactionChanges> {
  const stored = await tx.select(transactionFields).from(transactions).where(eq(transactions.accountId, accountId));

  const incoming = imported.map((transaction) => ({
    externalId: transaction.externalId,
    occurredAt: new Date(transaction.occurredAt),
    description: transaction.description,
    amountCents: transaction.amountCents,
    direction: transaction.direction,
    status: transaction.status,
    currency: transaction.currency,
    billId: transaction.billExternalId ? (billIds.get(transaction.billExternalId) ?? null) : null,
    billExternalId: transaction.billExternalId,
    installmentNumber: transaction.installment?.number ?? null,
    installmentTotal: transaction.installment?.total ?? null,
    providerCategory: transaction.providerCategory,
  }));
  const { created, updated } = detectChanges(
    incoming,
    new Map(stored.map((row) => [row.externalId, row])),
    (transaction) => transaction.externalId,
  );

  for (const batch of chunk([...created, ...updated])) {
    await tx
      .insert(transactions)
      .values(batch.map((transaction) => ({ accountId, ...transaction })))
      .onConflictDoUpdate({
        target: [transactions.accountId, transactions.externalId],
        set: {
          occurredAt: excluded("occurred_at"),
          description: excluded("description"),
          amountCents: excluded("amount_cents"),
          direction: excluded("direction"),
          status: excluded("status"),
          currency: excluded("currency"),
          billId: excluded("bill_id"),
          billExternalId: excluded("bill_external_id"),
          installmentNumber: excluded("installment_number"),
          installmentTotal: excluded("installment_total"),
          providerCategory: excluded("provider_category"),
          categorySource: sql`case when ${transactions.categorySource} in ('automatic', 'rule') and (${transactions.description} is distinct from excluded.description or ${transactions.providerCategory} is distinct from excluded.provider_category) then null else ${transactions.categorySource} end`,
          updatedAt: new Date(),
        },
      });
  }

  const incomingIds = new Set(incoming.map((transaction) => transaction.externalId));
  const vanished = stored
    .filter((row) => row.status === "pending" && !incomingIds.has(row.externalId))
    .map((row) => row.externalId);
  for (const batch of chunk(vanished)) {
    await tx.delete(transactions).where(and(eq(transactions.accountId, accountId), inArray(transactions.externalId, batch)));
  }

  return { created: created.length, updated: updated.length, removed: vanished.length };
}

type Categorizer = { categoryIds: Map<string, string>; rules: Map<string, string> };

async function categorizeTransactions(tx: Tx, accountId: string, { categoryIds, rules }: Categorizer) {
  const pending = await tx
    .select({ id: transactions.id, description: transactions.description, providerCategory: transactions.providerCategory })
    .from(transactions)
    .where(and(eq(transactions.accountId, accountId), isNull(transactions.categorySource)));

  for (const batch of chunk(pending)) {
    const values = batch.map((transaction) => {
      const merchant = merchantName(transaction.description);
      const ruleCategoryId = rules.get(merchant);
      if (ruleCategoryId) {
        return sql`(${transaction.id}::uuid, ${merchant}, ${ruleCategoryId}::uuid, 'rule')`;
      }
      const match = categorize(transaction);
      const categoryId = match ? (categoryIds.get(match.slug) ?? null) : null;
      return sql`(${transaction.id}::uuid, ${merchant}, ${categoryId}::uuid, 'automatic')`;
    });
    await tx.execute(sql`
      update ${transactions}
      set merchant_name = v.merchant_name, category_id = v.category_id, category_source = v.category_source
      from (values ${sql.join(values, sql`, `)}) as v(id, merchant_name, category_id, category_source)
      where ${transactions.id} = v.id
    `);
  }
}

function describeError(error: unknown) {
  if (error instanceof SyncError) {
    return error.message;
  }
  if (error instanceof AuthorizationExpiredError) {
    return "A autorização desta conexão expirou. Renove a conexão no Meu Pluggy para voltar a sincronizar.";
  }
  if (error instanceof EmptySourceError) {
    return "A Pluggy não retornou nenhuma conta desta conexão, o que costuma indicar autorização expirada. Nenhum dado foi alterado.";
  }
  if (error instanceof PluggyAuthError) {
    return "A Pluggy recusou as credenciais desta conexão. Cadastre-as novamente.";
  }
  if (error instanceof PluggyNotFoundError) {
    return "A Pluggy não encontrou este banco nas suas credenciais. Confira a conexão no Meu Pluggy.";
  }
  return "Não foi possível sincronizar agora. Tente novamente em instantes.";
}

export async function syncConnection(connectionId: string): Promise<SyncResult> {
  const db = getDb();
  const [connection] = await db
    .select({
      id: integrationConnections.id,
      memberId: integrationConnections.memberId,
      externalItemId: integrationConnections.externalItemId,
      authorizationExpiresAt: integrationConnections.authorizationExpiresAt,
    })
    .from(integrationConnections)
    .where(eq(integrationConnections.id, connectionId))
    .limit(1);

  if (!connection) {
    return { ok: false, error: "Conexão não encontrada." };
  }

  await db
    .update(syncRuns)
    .set({ status: "failed", error: "Sincronização interrompida antes de terminar.", finishedAt: new Date() })
    .where(
      and(
        eq(syncRuns.connectionId, connectionId),
        eq(syncRuns.status, "running"),
        lt(syncRuns.startedAt, new Date(Date.now() - STALE_RUN_MINUTES * 60 * 1000)),
      ),
    );

  const [run] = await db.insert(syncRuns).values({ connectionId }).onConflictDoNothing().returning({ id: syncRuns.id });
  if (!run) {
    return { ok: false, error: "Já existe uma sincronização em andamento para esta conexão." };
  }

  try {
    const [credentials] = await db
      .select()
      .from(pluggyCredentials)
      .where(eq(pluggyCredentials.memberId, connection.memberId))
      .limit(1);
    if (!credentials) {
      throw new SyncError("Cadastre as credenciais da Pluggy antes de sincronizar.");
    }

    const apiKey = await authenticate({
      clientId: credentials.clientId,
      clientSecret: decrypt(credentials.clientSecretEncrypted),
    });
    const item = await getItem(apiKey, connection.externalItemId);
    const authorizationExpiresAt = item.consentExpiresAt ?? connection.authorizationExpiresAt;
    if (item.consentExpiresAt) {
      await db
        .update(integrationConnections)
        .set({ authorizationExpiresAt: item.consentExpiresAt })
        .where(eq(integrationConnections.id, connection.id));
    }
    if (
      (item.errorCode && EXPIRED_ERROR_CODES.has(item.errorCode)) ||
      item.status === "LOGIN_ERROR" ||
      (authorizationExpiresAt && authorizationExpiresAt.getTime() <= Date.now())
    ) {
      throw new AuthorizationExpiredError();
    }

    const accounts = await listAccounts(apiKey, connection.externalItemId);
    if (accounts.length === 0 && (await db.$count(financialAccounts, eq(financialAccounts.connectionId, connection.id))) > 0) {
      throw new EmptySourceError();
    }

    let billsCount = 0;
    let transactionsCount = 0;
    const changes: TransactionChanges = { created: 0, updated: 0, removed: 0 };
    const [categoryRows, ruleRows] = await Promise.all([
      db.select({ id: categories.id, slug: categories.slug }).from(categories),
      db
        .select({ merchantName: categoryRules.merchantName, categoryId: categoryRules.categoryId })
        .from(categoryRules)
        .innerJoin(householdMembers, eq(householdMembers.householdId, categoryRules.householdId))
        .where(eq(householdMembers.id, connection.memberId)),
    ]);
    const categorizer: Categorizer = {
      categoryIds: new Map(categoryRows.map((row) => [row.slug, row.id])),
      rules: new Map(ruleRows.map((row) => [row.merchantName, row.categoryId])),
    };
    for (const account of accounts) {
      const bills = account.kind === "credit_card" ? await listBills(apiKey, account) : [];
      const imported = await listTransactions(apiKey, account);

      const accountChanges = await db.transaction(async (tx) => {
        const accountId = await saveAccount(tx, connection.id, account);
        const billIds = await saveBills(tx, accountId, bills);
        const saved = await saveTransactions(tx, accountId, imported, billIds);
        await categorizeTransactions(tx, accountId, categorizer);
        return saved;
      });
      changes.created += accountChanges.created;
      changes.updated += accountChanges.updated;
      changes.removed += accountChanges.removed;

      billsCount += bills.length;
      transactionsCount += imported.length;
    }

    const finishedAt = new Date();
    await db
      .update(integrationConnections)
      .set({ status: "active", lastSyncedAt: finishedAt })
      .where(eq(integrationConnections.id, connection.id));
    await db
      .update(syncRuns)
      .set({
        status: "succeeded",
        accountsCount: accounts.length,
        billsCount,
        transactionsCount,
        transactionsCreated: changes.created,
        transactionsUpdated: changes.updated,
        transactionsRemoved: changes.removed,
        finishedAt,
      })
      .where(eq(syncRuns.id, run.id));

    return { ok: true, accounts: accounts.length, bills: billsCount, transactions: transactionsCount, changes };
  } catch (error) {
    const message = describeError(error);
    if (error instanceof AuthorizationExpiredError) {
      await db
        .update(integrationConnections)
        .set({ status: "expired" })
        .where(eq(integrationConnections.id, connection.id));
    } else if (error instanceof PluggyAuthError || error instanceof PluggyNotFoundError || error instanceof EmptySourceError) {
      await db
        .update(integrationConnections)
        .set({ status: "error" })
        .where(eq(integrationConnections.id, connection.id));
    } else if (!(error instanceof SyncError)) {
      console.error("Falha ao sincronizar conexão", connection.id, error);
    }
    await db
      .update(syncRuns)
      .set({ status: "failed", error: message, finishedAt: new Date() })
      .where(eq(syncRuns.id, run.id));
    return { ok: false, error: message };
  }
}

export type SyncAllSummary = {
  total: number;
  succeeded: number;
  failed: number;
  results: { connectionId: string; result: SyncResult }[];
};

export async function syncAllConnections(): Promise<SyncAllSummary> {
  const connections = await getDb()
    .select({ id: integrationConnections.id })
    .from(integrationConnections)
    .where(ne(integrationConnections.status, "revoked"))
    .orderBy(asc(integrationConnections.createdAt));

  const results: SyncAllSummary["results"] = [];
  for (const connection of connections) {
    const result = await syncConnection(connection.id).catch((error: unknown): SyncResult => {
      console.error("Falha inesperada ao sincronizar conexão", connection.id, error);
      return { ok: false, error: "Falha inesperada ao sincronizar." };
    });
    results.push({ connectionId: connection.id, result });
  }

  const succeeded = results.filter(({ result }) => result.ok).length;
  return { total: results.length, succeeded, failed: results.length - succeeded, results };
}

export async function latestSyncRuns(connectionIds: string[]) {
  if (connectionIds.length === 0) {
    return new Map<
      string,
      { status: string; error: string | null; startedAt: Date; created: number; updated: number; removed: number }
    >();
  }
  const runs = await getDb()
    .selectDistinctOn([syncRuns.connectionId], {
      connectionId: syncRuns.connectionId,
      status: syncRuns.status,
      error: syncRuns.error,
      startedAt: syncRuns.startedAt,
      created: syncRuns.transactionsCreated,
      updated: syncRuns.transactionsUpdated,
      removed: syncRuns.transactionsRemoved,
    })
    .from(syncRuns)
    .where(inArray(syncRuns.connectionId, connectionIds))
    .orderBy(syncRuns.connectionId, desc(syncRuns.startedAt));
  return new Map(runs.map((run) => [run.connectionId, run]));
}
