import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { financialAccounts, householdSharedAccounts, integrationConnections } from "@/db/schema";
import { recordChange } from "./change-log";
import { UUID_PATTERN } from "./connections";
import { listHouseholdLinks } from "./profiles";

export type ShareResult = { ok: true; message: string } | { ok: false; error: string };

export async function listOwnAccounts(memberId: string) {
  return getDb()
    .select({
      id: financialAccounts.id,
      kind: financialAccounts.kind,
      name: financialAccounts.name,
      numberLast4: financialAccounts.numberLast4,
      institutionName: integrationConnections.institutionName,
      sharedHouseholdId: householdSharedAccounts.householdId,
    })
    .from(financialAccounts)
    .innerJoin(integrationConnections, eq(integrationConnections.id, financialAccounts.connectionId))
    .leftJoin(householdSharedAccounts, eq(householdSharedAccounts.accountId, financialAccounts.id))
    .where(eq(integrationConnections.memberId, memberId))
    .orderBy(asc(integrationConnections.institutionName), asc(financialAccounts.kind), asc(financialAccounts.name));
}

export async function shareAccount(memberId: string, accountId: string, householdId: string): Promise<ShareResult> {
  if (!UUID_PATTERN.test(accountId) || (householdId !== "" && !UUID_PATTERN.test(householdId))) {
    return { ok: false, error: "Conta ou residência inválida." };
  }

  const db = getDb();
  const [account] = await db
    .select({ id: financialAccounts.id, name: financialAccounts.name })
    .from(financialAccounts)
    .innerJoin(integrationConnections, eq(integrationConnections.id, financialAccounts.connectionId))
    .where(and(eq(financialAccounts.id, accountId), eq(integrationConnections.memberId, memberId)));
  if (!account) {
    return { ok: false, error: "Só o titular pode escolher onde a conta aparece." };
  }

  const [current] = await db
    .select({ householdId: householdSharedAccounts.householdId })
    .from(householdSharedAccounts)
    .where(eq(householdSharedAccounts.accountId, accountId));

  if (householdId === "") {
    if (!current) {
      return { ok: true, message: "A conta já é privada." };
    }
    await db.transaction(async (tx) => {
      await tx.delete(householdSharedAccounts).where(eq(householdSharedAccounts.accountId, accountId));
      await recordChange(tx, {
        householdId: current.householdId,
        memberId,
        kind: "account_unshared",
        subject: account.name,
        previousValue: null,
        newValue: null,
      });
    });
    return { ok: true, message: "A conta voltou a ser privada." };
  }

  const links = await listHouseholdLinks(memberId);
  if (!links.some((link) => link.householdId === householdId)) {
    return { ok: false, error: "Você não participa dessa residência." };
  }
  if (current?.householdId === householdId) {
    return { ok: true, message: "A conta já está compartilhada com essa residência." };
  }

  await db.transaction(async (tx) => {
    await tx
      .insert(householdSharedAccounts)
      .values({ householdId, accountId, sharedByMemberId: memberId })
      .onConflictDoUpdate({
        target: householdSharedAccounts.accountId,
        set: { householdId, sharedByMemberId: memberId, createdAt: new Date() },
      });
    await recordChange(tx, {
      householdId,
      memberId,
      kind: "account_shared",
      subject: account.name,
      previousValue: null,
      newValue: null,
    });
  });
  return { ok: true, message: "Conta compartilhada com a residência." };
}
