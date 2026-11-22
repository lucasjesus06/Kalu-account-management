import "server-only";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { sendNotification } from "web-push";
import { getDb } from "@/db/client";
import { budgetAlerts, budgetGoals, categories, householdMembers, pushSubscriptions } from "@/db/schema";
import { goalLabel } from "@/domain/budget";
import { fromCents } from "@/domain/money";
import { parsePushSubscription } from "@/domain/push";
import { formatBRL, formatMonth } from "@/lib/format";
import type { ActionResult } from "./connections";
import { expenseMembers } from "./expense-nature";

type Member = { memberId: string; householdId: string };

const RECENT_ALERT_MS = 48 * 60 * 60 * 1000;

export type PushPayload = { title: string; body: string; url: string; tag: string };

function vapidEnv() {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  const subject = process.env.VAPID_SUBJECT?.trim();
  return publicKey && privateKey && subject ? { publicKey, privateKey, subject } : null;
}

export function vapidPublicKey() {
  return vapidEnv()?.publicKey ?? null;
}

export async function countMemberSubscriptions(memberId: string) {
  const rows = await getDb()
    .select({ id: pushSubscriptions.id })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.memberId, memberId));
  return rows.length;
}

export async function saveSubscription(member: Member, input: unknown): Promise<ActionResult> {
  if (!vapidEnv()) {
    return { ok: false, error: "As notificações ainda não foram configuradas no servidor." };
  }
  const subscription = parsePushSubscription(input);
  if (!subscription) {
    return { ok: false, error: "Não foi possível ativar as notificações neste aparelho." };
  }
  await getDb()
    .insert(pushSubscriptions)
    .values({ memberId: member.memberId, ...subscription })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: { memberId: member.memberId, p256dh: subscription.p256dh, auth: subscription.auth },
    });
  return { ok: true, message: "Notificações ativadas neste aparelho." };
}

export async function removeSubscription(member: Member, endpoint: string): Promise<ActionResult> {
  await getDb()
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.endpoint, endpoint), eq(pushSubscriptions.memberId, member.memberId)));
  return { ok: true, message: "Notificações desativadas neste aparelho." };
}

async function sendToHousehold(householdId: string, payload: PushPayload) {
  const vapid = vapidEnv();
  if (!vapid) {
    return 0;
  }
  const db = getDb();
  const subscriptions = await db
    .select({ id: pushSubscriptions.id, endpoint: pushSubscriptions.endpoint, p256dh: pushSubscriptions.p256dh, auth: pushSubscriptions.auth })
    .from(pushSubscriptions)
    .innerJoin(householdMembers, eq(householdMembers.id, pushSubscriptions.memberId))
    .where(eq(householdMembers.householdId, householdId));
  const expired: string[] = [];
  let delivered = 0;
  await Promise.all(
    subscriptions.map(async (subscription) => {
      try {
        await sendNotification(
          { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
          JSON.stringify(payload),
          { TTL: 24 * 60 * 60, vapidDetails: vapid },
        );
        delivered += 1;
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          expired.push(subscription.id);
        } else {
          console.error("Falha ao enviar notificação", status ?? error);
        }
      }
    }),
  );
  if (expired.length > 0) {
    await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, expired));
  }
  return delivered;
}

export async function dispatchBudgetPushes(householdId: string, now: Date) {
  if (!vapidEnv()) {
    return 0;
  }
  const db = getDb();
  const pending = await db
    .select({
      id: budgetAlerts.id,
      goalId: budgetAlerts.goalId,
      month: budgetAlerts.month,
      threshold: budgetAlerts.threshold,
      consumedCents: budgetAlerts.consumedCents,
      limitCents: budgetAlerts.limitCents,
      triggeredAt: budgetAlerts.triggeredAt,
      categoryName: categories.name,
      nature: budgetGoals.expenseNature,
      memberId: budgetGoals.expenseMemberId,
      memberName: expenseMembers.displayName,
    })
    .from(budgetAlerts)
    .innerJoin(budgetGoals, eq(budgetGoals.id, budgetAlerts.goalId))
    .leftJoin(categories, eq(categories.id, budgetGoals.categoryId))
    .leftJoin(expenseMembers, eq(expenseMembers.id, budgetGoals.expenseMemberId))
    .where(and(eq(budgetGoals.householdId, householdId), isNull(budgetAlerts.notifiedAt)));
  if (pending.length === 0) {
    return 0;
  }

  const claimed = await db
    .update(budgetAlerts)
    .set({ notifiedAt: now })
    .where(and(inArray(budgetAlerts.id, pending.map((alert) => alert.id)), isNull(budgetAlerts.notifiedAt)))
    .returning({ id: budgetAlerts.id });
  const claimedIds = new Set(claimed.map((row) => row.id));
  const since = now.getTime() - RECENT_ALERT_MS;

  const highest = new Map<string, (typeof pending)[number]>();
  for (const alert of pending) {
    if (!claimedIds.has(alert.id) || alert.triggeredAt.getTime() < since) {
      continue;
    }
    const key = `${alert.goalId}:${alert.month}`;
    const current = highest.get(key);
    if (!current || alert.threshold > current.threshold) {
      highest.set(key, alert);
    }
  }

  let sent = 0;
  for (const [key, alert] of highest) {
    const label = goalLabel({ categoryName: alert.categoryName, nature: alert.nature, memberId: alert.memberId, memberName: alert.memberName });
    sent += await sendToHousehold(householdId, {
      title: `${label}: ${alert.threshold >= 100 ? "passou de" : "chegou a"} ${alert.threshold}% da meta`,
      body: `${formatBRL(fromCents(alert.consumedCents))} de ${formatBRL(fromCents(alert.limitCents))} em ${formatMonth(alert.month)}`,
      url: "/metas",
      tag: `meta-${key}`,
    });
  }
  return sent;
}
