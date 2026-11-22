import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, asc, eq, gt, isNull, ne, sql } from "drizzle-orm";
import { asService, getDb } from "@/db/client";
import { householdInvites, householdMembers, householdMemberships, householdSharedAccounts, households } from "@/db/schema";
import { inviteExpiry, inviteStatus, parseHouseholdName } from "@/domain/invite";
import { recordChange, type ChangeEntry } from "./change-log";
import { UUID_PATTERN } from "./connections";

export type HouseholdResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

async function roleOf(db: Db | Tx, memberId: string, householdId: string) {
  const [row] = await db
    .select({ role: householdMemberships.role })
    .from(householdMemberships)
    .where(and(eq(householdMemberships.householdId, householdId), eq(householdMemberships.memberId, memberId)));
  return row?.role ?? null;
}

async function nameOf(db: Db | Tx, memberId: string) {
  const [row] = await db.select({ name: householdMembers.displayName }).from(householdMembers).where(eq(householdMembers.id, memberId));
  return row?.name ?? "Integrante";
}

function logMember(tx: Tx, entry: Pick<ChangeEntry, "householdId" | "memberId" | "kind" | "subject">) {
  return recordChange(tx, { ...entry, previousValue: null, newValue: null });
}

async function detach(tx: Tx, householdId: string, memberId: string) {
  await tx
    .delete(householdSharedAccounts)
    .where(and(eq(householdSharedAccounts.householdId, householdId), eq(householdSharedAccounts.sharedByMemberId, memberId)));
  await tx
    .delete(householdMemberships)
    .where(and(eq(householdMemberships.householdId, householdId), eq(householdMemberships.memberId, memberId)));
  await tx
    .update(householdMembers)
    .set({ householdId: null })
    .where(and(eq(householdMembers.id, memberId), eq(householdMembers.householdId, householdId)));
}

async function createHouseholdImpl(memberId: string, rawName: unknown): Promise<HouseholdResult<{ householdId: string }>> {
  const name = parseHouseholdName(rawName);
  if (!name) {
    return { ok: false, error: "Dê um nome de até 60 caracteres para a residência." };
  }
  const householdId = await getDb().transaction(async (tx) => {
    const [household] = await tx.insert(households).values({ name }).returning({ id: households.id });
    await tx.insert(householdMemberships).values({ householdId: household.id, memberId, role: "admin" });
    return household.id;
  });
  return { ok: true, householdId };
}

export async function listManagedHouseholds(memberId: string, now = new Date()) {
  const db = getDb();
  const links = await db
    .select({ id: households.id, name: households.name, role: householdMemberships.role })
    .from(householdMemberships)
    .innerJoin(households, eq(households.id, householdMemberships.householdId))
    .where(eq(householdMemberships.memberId, memberId))
    .orderBy(asc(householdMemberships.createdAt), asc(householdMemberships.id));

  return Promise.all(
    links.map(async (link) => {
      const members = await db
        .select({ id: householdMembers.id, displayName: householdMembers.displayName, role: householdMemberships.role })
        .from(householdMemberships)
        .innerJoin(householdMembers, eq(householdMembers.id, householdMemberships.memberId))
        .where(eq(householdMemberships.householdId, link.id))
        .orderBy(asc(householdMemberships.createdAt), asc(householdMemberships.id));
      const invites =
        link.role === "admin"
          ? (
              await db
                .select({ id: householdInvites.id, expiresAt: householdInvites.expiresAt })
                .from(householdInvites)
                .where(
                  and(
                    eq(householdInvites.householdId, link.id),
                    isNull(householdInvites.usedAt),
                    isNull(householdInvites.revokedAt),
                    gt(householdInvites.expiresAt, now),
                  ),
                )
                .orderBy(asc(householdInvites.createdAt))
            )
          : [];
      return { ...link, members, invites };
    }),
  );
}

export async function createInvite(memberId: string, householdId: string, now = new Date()): Promise<HouseholdResult<{ token: string }>> {
  if (!UUID_PATTERN.test(householdId)) {
    return { ok: false, error: "Residência inválida." };
  }
  const db = getDb();
  if ((await roleOf(db, memberId, householdId)) !== "admin") {
    return { ok: false, error: "Só quem administra a residência pode convidar." };
  }
  const token = randomBytes(24).toString("base64url");
  await db.insert(householdInvites).values({
    householdId,
    tokenHash: hashToken(token),
    createdByMemberId: memberId,
    expiresAt: inviteExpiry(now),
  });
  return { ok: true, token };
}

export async function revokeInvite(memberId: string, inviteId: string): Promise<HouseholdResult> {
  if (!UUID_PATTERN.test(inviteId)) {
    return { ok: false, error: "Convite inválido." };
  }
  const db = getDb();
  const [invite] = await db.select({ householdId: householdInvites.householdId }).from(householdInvites).where(eq(householdInvites.id, inviteId));
  if (!invite || (await roleOf(db, memberId, invite.householdId)) !== "admin") {
    return { ok: false, error: "Só quem administra a residência pode cancelar convites." };
  }
  await db
    .update(householdInvites)
    .set({ revokedAt: new Date() })
    .where(and(eq(householdInvites.id, inviteId), isNull(householdInvites.usedAt), isNull(householdInvites.revokedAt)));
  return { ok: true };
}

async function getInvitePreviewImpl(token: string, now = new Date()) {
  const [invite] = await getDb()
    .select({
      householdName: households.name,
      inviterName: householdMembers.displayName,
      expiresAt: householdInvites.expiresAt,
      usedAt: householdInvites.usedAt,
      revokedAt: householdInvites.revokedAt,
    })
    .from(householdInvites)
    .innerJoin(households, eq(households.id, householdInvites.householdId))
    .innerJoin(householdMembers, eq(householdMembers.id, householdInvites.createdByMemberId))
    .where(eq(householdInvites.tokenHash, hashToken(token)));
  return invite ? { householdName: invite.householdName, inviterName: invite.inviterName, status: inviteStatus(invite, now) } : null;
}

async function acceptInviteImpl(memberId: string, token: string, now = new Date()): Promise<HouseholdResult<{ householdName: string }>> {
  const db = getDb();
  const [invite] = await db
    .select({
      id: householdInvites.id,
      householdId: householdInvites.householdId,
      householdName: households.name,
      expiresAt: householdInvites.expiresAt,
      usedAt: householdInvites.usedAt,
      revokedAt: householdInvites.revokedAt,
    })
    .from(householdInvites)
    .innerJoin(households, eq(households.id, householdInvites.householdId))
    .where(eq(householdInvites.tokenHash, hashToken(token)));
  if (!invite) {
    return { ok: false, error: "Convite não encontrado." };
  }
  const status = inviteStatus(invite, now);
  if (status !== "usable") {
    const reasons = { used: "Este convite já foi usado.", revoked: "Este convite foi cancelado.", expired: "Este convite expirou." };
    return { ok: false, error: `${reasons[status]} Peça um novo a quem administra a residência.` };
  }
  if (await roleOf(db, memberId, invite.householdId)) {
    return { ok: false, error: "Você já participa desta residência." };
  }

  const name = await nameOf(db, memberId);
  const accepted = await db.transaction(async (tx) => {
    const claimed = await tx
      .update(householdInvites)
      .set({ usedAt: now, usedByMemberId: memberId })
      .where(
        and(
          eq(householdInvites.id, invite.id),
          isNull(householdInvites.usedAt),
          isNull(householdInvites.revokedAt),
          gt(householdInvites.expiresAt, now),
        ),
      )
      .returning({ id: householdInvites.id });
    if (claimed.length === 0) {
      return false;
    }
    await tx.insert(householdMemberships).values({ householdId: invite.householdId, memberId, role: "member" });
    await logMember(tx, { householdId: invite.householdId, memberId, kind: "member_joined", subject: name });
    return true;
  });
  return accepted
    ? { ok: true, householdName: invite.householdName }
    : { ok: false, error: "Este convite não está mais disponível. Peça um novo a quem administra a residência." };
}

export async function leaveHousehold(memberId: string, householdId: string): Promise<HouseholdResult<{ closed: boolean }>> {
  if (!UUID_PATTERN.test(householdId)) {
    return { ok: false, error: "Residência inválida." };
  }
  const db = getDb();
  const role = await roleOf(db, memberId, householdId);
  if (!role) {
    return { ok: false, error: "Você não participa desta residência." };
  }
  const [{ others }] = await db
    .select({ others: sql<number>`count(*)`.mapWith(Number) })
    .from(householdMemberships)
    .where(and(eq(householdMemberships.householdId, householdId), ne(householdMemberships.memberId, memberId)));

  if (role === "admin" && others > 0) {
    return { ok: false, error: "Passe a administração para outro integrante antes de sair." };
  }

  if (others === 0) {
    await asService(() =>
      getDb().transaction(async (tx) => {
        await tx.update(householdMembers).set({ householdId: null }).where(eq(householdMembers.householdId, householdId));
        await tx.delete(households).where(eq(households.id, householdId));
      }),
    );
    return { ok: true, closed: true };
  }

  const name = await nameOf(db, memberId);
  await db.transaction(async (tx) => {
    await logMember(tx, { householdId, memberId, kind: "member_left", subject: name });
    await detach(tx, householdId, memberId);
  });
  return { ok: true, closed: false };
}

export async function removeMember(adminId: string, householdId: string, targetId: string): Promise<HouseholdResult> {
  if (!UUID_PATTERN.test(householdId) || !UUID_PATTERN.test(targetId)) {
    return { ok: false, error: "Integrante inválido." };
  }
  const db = getDb();
  if ((await roleOf(db, adminId, householdId)) !== "admin") {
    return { ok: false, error: "Só quem administra a residência pode remover integrantes." };
  }
  if (adminId === targetId) {
    return { ok: false, error: "Para sair, use a opção Sair da residência." };
  }
  if (!(await roleOf(db, targetId, householdId))) {
    return { ok: false, error: "Essa pessoa não participa da residência." };
  }
  const name = await nameOf(db, targetId);
  await db.transaction(async (tx) => {
    await logMember(tx, { householdId, memberId: adminId, kind: "member_removed", subject: name });
    await detach(tx, householdId, targetId);
  });
  return { ok: true };
}

export async function transferAdmin(adminId: string, householdId: string, targetId: string): Promise<HouseholdResult> {
  if (!UUID_PATTERN.test(householdId) || !UUID_PATTERN.test(targetId)) {
    return { ok: false, error: "Integrante inválido." };
  }
  const db = getDb();
  if ((await roleOf(db, adminId, householdId)) !== "admin") {
    return { ok: false, error: "Só quem administra a residência pode passar a administração." };
  }
  if (adminId === targetId || (await roleOf(db, targetId, householdId)) !== "member") {
    return { ok: false, error: "Escolha outro integrante da residência." };
  }
  const name = await nameOf(db, targetId);
  await asService(() =>
    getDb().transaction(async (tx) => {
      await tx
        .update(householdMemberships)
        .set({ role: "member" })
        .where(and(eq(householdMemberships.householdId, householdId), eq(householdMemberships.memberId, adminId)));
      await tx
        .update(householdMemberships)
        .set({ role: "admin" })
        .where(and(eq(householdMemberships.householdId, householdId), eq(householdMemberships.memberId, targetId)));
      await logMember(tx, { householdId, memberId: adminId, kind: "admin_transferred", subject: name });
    }),
  );
  return { ok: true };
}

export function createHousehold(...args: Parameters<typeof createHouseholdImpl>) {
  return asService(() => createHouseholdImpl(...args));
}

export function getInvitePreview(...args: Parameters<typeof getInvitePreviewImpl>) {
  return asService(() => getInvitePreviewImpl(...args));
}

export function acceptInvite(...args: Parameters<typeof acceptInviteImpl>) {
  return asService(() => acceptInviteImpl(...args));
}
