import "server-only";
import { and, desc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import {
  creditCardBills,
  financialAccounts,
  integrationConnections,
  pluggyCredentials,
  syncRuns,
  transactions,
} from "@/db/schema";
import type { ImportedAccount, ImportedBill, ImportedTransaction } from "@/domain/imported";
import {
  authenticate,
  listAccounts,
  listBills,
  listTransactions,
  PluggyAuthError,
  PluggyNotFoundError,
} from "@/integrations/pluggy/client";
import { decrypt } from "./crypto";

export type SyncResult =
  | { ok: true; accounts: number; bills: number; transactions: number }
  | { ok: false; error: string };

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const CHUNK_SIZE = 500;

class SyncError extends Error {}

function chunk<T>(items: T[]) {
  const chunks: T[][] = [];
  for (let start = 0; start < items.length; start += CHUNK_SIZE) {
    chunks.push(items.slice(start, start + CHUNK_SIZE));
  }
  return chunks;
}

const excluded = (column: string) => sql.raw(`excluded.${column}`);

async function upsertAccount(tx: Tx, connectionId: string, account: ImportedAccount) {
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

  const [row] = await tx
    .insert(financialAccounts)
    .values({ connectionId, externalId: account.externalId, ...values })
    .onConflictDoUpdate({
      target: [financialAccounts.connectionId, financialAccounts.externalId],
      set: { ...values, updatedAt: new Date() },
    })
    .returning({ id: financialAccounts.id });

  return row.id;
}

async function upsertBills(tx: Tx, accountId: string, bills: ImportedBill[]) {
  for (const batch of chunk(bills)) {
    await tx
      .insert(creditCardBills)
      .values(
        batch.map((bill) => ({
          accountId,
          externalId: bill.externalId,
          dueDate: bill.dueDate,
          totalCents: bill.totalCents,
          minimumPaymentCents: bill.minimumPaymentCents,
          currency: bill.currency,
        })),
      )
      .onConflictDoUpdate({
        target: [creditCardBills.accountId, creditCardBills.externalId],
        set: {
          dueDate: excluded("due_date"),
          totalCents: excluded("total_cents"),
          minimumPaymentCents: excluded("minimum_payment_cents"),
          currency: excluded("currency"),
          updatedAt: new Date(),
        },
      });
  }

  const stored = await tx
    .select({ id: creditCardBills.id, externalId: creditCardBills.externalId })
    .from(creditCardBills)
    .where(eq(creditCardBills.accountId, accountId));
  return new Map(stored.map((row) => [row.externalId, row.id]));
}

async function upsertTransactions(
  tx: Tx,
  accountId: string,
  imported: ImportedTransaction[],
  billIds: Map<string, string>,
) {
  for (const batch of chunk(imported)) {
    await tx
      .insert(transactions)
      .values(
        batch.map((transaction) => ({
          accountId,
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
        })),
      )
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
          updatedAt: new Date(),
        },
      });
  }

  await tx
    .delete(transactions)
    .where(
      and(
        eq(transactions.accountId, accountId),
        eq(transactions.status, "pending"),
        notInArray(
          transactions.externalId,
          imported.map((transaction) => transaction.externalId),
        ),
      ),
    );
}

function describeError(error: unknown) {
  if (error instanceof SyncError) {
    return error.message;
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
    })
    .from(integrationConnections)
    .where(eq(integrationConnections.id, connectionId))
    .limit(1);

  if (!connection) {
    return { ok: false, error: "Conexão não encontrada." };
  }

  const [run] = await db.insert(syncRuns).values({ connectionId }).returning({ id: syncRuns.id });

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
    const accounts = await listAccounts(apiKey, connection.externalItemId);

    let billsCount = 0;
    let transactionsCount = 0;
    for (const account of accounts) {
      const bills = account.kind === "credit_card" ? await listBills(apiKey, account) : [];
      const imported = await listTransactions(apiKey, account);

      await db.transaction(async (tx) => {
        const accountId = await upsertAccount(tx, connection.id, account);
        const billIds = await upsertBills(tx, accountId, bills);
        await upsertTransactions(tx, accountId, imported, billIds);
      });

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
        finishedAt,
      })
      .where(eq(syncRuns.id, run.id));

    return { ok: true, accounts: accounts.length, bills: billsCount, transactions: transactionsCount };
  } catch (error) {
    const message = describeError(error);
    if (error instanceof PluggyAuthError || error instanceof PluggyNotFoundError) {
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

export async function latestSyncRuns(connectionIds: string[]) {
  if (connectionIds.length === 0) {
    return new Map<string, { status: string; error: string | null; startedAt: Date }>();
  }
  const runs = await getDb()
    .selectDistinctOn([syncRuns.connectionId], {
      connectionId: syncRuns.connectionId,
      status: syncRuns.status,
      error: syncRuns.error,
      startedAt: syncRuns.startedAt,
    })
    .from(syncRuns)
    .where(inArray(syncRuns.connectionId, connectionIds))
    .orderBy(syncRuns.connectionId, desc(syncRuns.startedAt));
  return new Map(runs.map((run) => [run.connectionId, run]));
}
