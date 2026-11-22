import "server-only";
import { and, desc, eq, gte, isNull, lte, or } from "drizzle-orm";
import { asService, getDb } from "@/db/client";
import { budgetAlerts, budgetGoals, categories, householdMembers } from "@/db/schema";
import {
  goalLabel,
  goalProgress,
  isActiveIn,
  parseMoneyInput,
  parseThresholds,
  sameTarget,
  type BudgetGoal,
} from "@/domain/budget";
import { goalSummary } from "@/domain/change-log";
import { parseExpenseChoice } from "@/domain/expense-nature";
import { fromCents } from "@/domain/money";
import { fullMonth, monthOf, shiftMonth } from "@/domain/periods";
import { householdScope } from "@/domain/scope";
import { formatBRL } from "@/lib/format";
import { UUID_PATTERN, type ActionResult } from "./connections";
import { recordChange } from "./change-log";
import { loadConsumptionRecords } from "./consumption";
import { expenseMembers } from "./expense-nature";
import { dispatchBudgetPushes } from "./push";

type Member = { memberId: string; householdId: string };

export async function listGoals(householdId: string, month?: string): Promise<BudgetGoal[]> {
  const rows = await getDb()
    .select({
      id: budgetGoals.id,
      categorySlug: categories.slug,
      categoryName: categories.name,
      nature: budgetGoals.expenseNature,
      memberId: budgetGoals.expenseMemberId,
      memberName: expenseMembers.displayName,
      limitCents: budgetGoals.limitCents,
      thresholds: budgetGoals.alertThresholds,
      startsMonth: budgetGoals.startsMonth,
      endsMonth: budgetGoals.endsMonth,
    })
    .from(budgetGoals)
    .leftJoin(categories, eq(categories.id, budgetGoals.categoryId))
    .leftJoin(expenseMembers, eq(expenseMembers.id, budgetGoals.expenseMemberId))
    .where(
      and(
        eq(budgetGoals.householdId, householdId),
        month ? lte(budgetGoals.startsMonth, month) : undefined,
        month ? or(isNull(budgetGoals.endsMonth), gte(budgetGoals.endsMonth, month)) : undefined,
      ),
    )
    .orderBy(categories.sortOrder, budgetGoals.createdAt);
  return rows;
}

export async function evaluateBudgetAlerts(householdId: string, now: Date) {
  const month = monthOf(now);
  const goals = await listGoals(householdId, month);
  if (goals.length === 0) {
    return 0;
  }
  const period = fullMonth(month);
  const { records, billTotals } = await loadConsumptionRecords(householdScope(householdId), period);
  const values = goals.flatMap((goal) => {
    const progress = goalProgress(goal, records, billTotals, period);
    return progress.reached.map((threshold) => ({
      goalId: goal.id,
      month,
      threshold,
      consumedCents: progress.consumedCents,
      limitCents: goal.limitCents,
      triggeredAt: now,
    }));
  });
  if (values.length === 0) {
    return 0;
  }
  const created = await getDb().insert(budgetAlerts).values(values).onConflictDoNothing().returning({ id: budgetAlerts.id });
  return created.length;
}

async function evaluateAndNotifyImpl(householdId: string, now: Date) {
  const created = await evaluateBudgetAlerts(householdId, now);
  await dispatchBudgetPushes(householdId, now).catch((error) => console.error("Falha ao enviar os avisos", error));
  return created;
}

export async function getBudgetOverview(householdId: string, month: string) {
  const period = fullMonth(month);
  const [goals, { records, billTotals }] = await Promise.all([
    listGoals(householdId, month),
    loadConsumptionRecords(householdScope(householdId), period),
  ]);
  return goals.map((goal) => ({ goal, label: goalLabel(goal), progress: goalProgress(goal, records, billTotals, period) }));
}

export async function listAlerts(householdId: string, limit = 50) {
  const rows = await getDb()
    .select({
      id: budgetAlerts.id,
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
    .where(eq(budgetGoals.householdId, householdId))
    .orderBy(desc(budgetAlerts.triggeredAt), desc(budgetAlerts.threshold))
    .limit(limit);
  return rows.map(({ categoryName, nature, memberId, memberName, ...alert }) => ({
    ...alert,
    label: goalLabel({ categoryName, nature, memberId, memberName }),
  }));
}

export type GoalInput = { goalId?: string; categoryId: string; expense: string; limit: string; thresholds: string };

export async function saveGoal(member: Member, input: GoalInput, now: Date): Promise<ActionResult> {
  const db = getDb();
  const month = monthOf(now);
  const limitCents = parseMoneyInput(input.limit);
  if (limitCents === null) {
    return { ok: false, error: "Informe o valor da meta, por exemplo 500 ou 1.200,50." };
  }
  const thresholds = parseThresholds(input.thresholds);
  if (thresholds === null) {
    return { ok: false, error: "Informe até 5 percentuais entre 1 e 300 para os avisos, por exemplo 70, 90, 100." };
  }

  const members = await db
    .select({ id: householdMembers.id, displayName: householdMembers.displayName })
    .from(householdMembers)
    .where(eq(householdMembers.householdId, member.householdId));
  const assignment = parseExpenseChoice(
    input.expense,
    members.map((m) => m.id),
  );
  if (assignment === undefined) {
    return { ok: false, error: "Escolha para quem vale a meta." };
  }

  let category: { id: string; slug: string; name: string } | null = null;
  if (input.categoryId) {
    if (!UUID_PATTERN.test(input.categoryId)) {
      return { ok: false, error: "Categoria não encontrada." };
    }
    [category] = await db
      .select({ id: categories.id, slug: categories.slug, name: categories.name })
      .from(categories)
      .where(and(eq(categories.id, input.categoryId), eq(categories.kind, "expense")));
    if (!category) {
      return { ok: false, error: "Categoria não encontrada." };
    }
  }

  const target = {
    categorySlug: category?.slug ?? null,
    nature: assignment?.nature ?? null,
    memberId: assignment?.memberId ?? null,
  };
  const active = await listGoals(member.householdId, month);
  if (active.some((goal) => goal.id !== input.goalId && sameTarget(goal, target))) {
    return { ok: false, error: "Já existe uma meta para essa categoria e para quem. Edite a meta existente." };
  }

  const values = {
    categoryId: category?.id ?? null,
    expenseNature: target.nature,
    expenseMemberId: target.memberId,
    limitCents,
    alertThresholds: thresholds,
    createdByMemberId: member.memberId,
  };
  const label = goalLabel({
    categoryName: category?.name ?? null,
    ...target,
    memberName: members.find((m) => m.id === target.memberId)?.displayName ?? null,
  });
  const amount = formatBRL(fromCents(limitCents));
  const logChange = (
    executor: Parameters<typeof recordChange>[0],
    kind: "goal_created" | "goal_updated",
    previousValue: string | null,
  ) =>
    recordChange(executor, {
      householdId: member.householdId,
      memberId: member.memberId,
      kind,
      subject: label,
      previousValue,
      newValue: `${label}: ${goalSummary(limitCents, thresholds)}`,
    });

  if (!input.goalId) {
    await db.transaction(async (tx) => {
      await tx.insert(budgetGoals).values({ householdId: member.householdId, startsMonth: month, ...values });
      await logChange(tx, "goal_created", null);
    });
    await evaluateAndNotify(member.householdId, now);
    return { ok: true, message: `Meta de ${label} criada: ${amount} por mês.` };
  }

  const existing = active.find((goal) => goal.id === input.goalId);
  if (!UUID_PATTERN.test(input.goalId) || !existing) {
    return { ok: false, error: "Meta não encontrada." };
  }
  const previousValue = `${goalLabel(existing)}: ${goalSummary(existing.limitCents, existing.thresholds)}`;
  await db.transaction(async (tx) => {
    if (existing.startsMonth === month) {
      await tx
        .update(budgetGoals)
        .set({ ...values, updatedAt: now })
        .where(eq(budgetGoals.id, existing.id));
    } else {
      await tx
        .update(budgetGoals)
        .set({ endsMonth: shiftMonth(month, -1), updatedAt: now })
        .where(eq(budgetGoals.id, existing.id));
      await tx.insert(budgetGoals).values({ householdId: member.householdId, startsMonth: month, ...values });
    }
    await logChange(tx, "goal_updated", previousValue);
  });
  await evaluateAndNotify(member.householdId, now);
  return {
    ok: true,
    message:
      existing.startsMonth === month
        ? `Meta de ${label} atualizada: ${amount} por mês.`
        : `Meta de ${label} atualizada: ${amount} por mês a partir deste mês. Os meses anteriores mantêm o valor antigo.`,
  };
}

export async function removeGoal(member: Member, goalId: string, now: Date): Promise<ActionResult> {
  if (!UUID_PATTERN.test(goalId)) {
    return { ok: false, error: "Meta não encontrada." };
  }
  const month = monthOf(now);
  const goal = (await listGoals(member.householdId, month)).find((g) => g.id === goalId);
  if (!goal || !isActiveIn(goal, month)) {
    return { ok: false, error: "Meta não encontrada." };
  }
  const db = getDb();
  const removed = {
    householdId: member.householdId,
    memberId: member.memberId,
    kind: "goal_removed" as const,
    subject: goalLabel(goal),
    previousValue: `${goalLabel(goal)}: ${goalSummary(goal.limitCents, goal.thresholds)}`,
    newValue: null,
  };
  if (goal.startsMonth === month) {
    await db.transaction(async (tx) => {
      await tx.delete(budgetGoals).where(eq(budgetGoals.id, goal.id));
      await recordChange(tx, removed);
    });
    return { ok: true, message: "Meta removida." };
  }
  await db.transaction(async (tx) => {
    await tx
      .update(budgetGoals)
      .set({ endsMonth: shiftMonth(month, -1), updatedAt: now })
      .where(eq(budgetGoals.id, goal.id));
    await recordChange(tx, removed);
  });
  return { ok: true, message: "Meta encerrada. Ela continua aparecendo nos meses em que valeu." };
}

export function evaluateAndNotify(...args: Parameters<typeof evaluateAndNotifyImpl>) {
  return asService(() => evaluateAndNotifyImpl(...args));
}
