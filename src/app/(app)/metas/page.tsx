import { householdScope } from "@/domain/scope";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { BellRing, Plus, Target } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Panel } from "@/components/panel";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Money } from "@/components/money";
import { expenseChoiceOf } from "@/domain/expense-nature";
import { fromCents } from "@/domain/money";
import { isMonth, monthOf } from "@/domain/periods";
import { formatDateTime, formatMonth } from "@/lib/format";
import { getRenderMember, getRenderHouseholdMembers } from "@/server/auth";
import { getBudgetOverview, listAlerts } from "@/server/budget";
import { countMemberSubscriptions, vapidPublicKey } from "@/server/push";
import { listCategories } from "@/server/categorization";
import { availableMonths } from "@/server/consumption";
import { GoalForm, RemoveGoalButton } from "./goal-form";
import { GoalProgressItem } from "./goal-progress";
import { PushToggle } from "./push-toggle";

export const metadata: Metadata = {
  title: "Metas · Kalu",
};

const selectClassName =
  "h-9 rounded-md border border-input bg-input/30 px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

function limitInput(cents: number) {
  return fromCents(cents).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function GoalsContent({ searchParams }: Pick<PageProps<"/metas">, "searchParams">) {
  const member = await getRenderMember();
  if (!member) {
    return <p className="text-muted-foreground">Sua conta ainda não está vinculada a uma residência.</p>;
  }

  const { mes } = await searchParams;
  const currentMonth = monthOf(new Date());
  const month = typeof mes === "string" && isMonth(mes) && mes <= currentMonth ? mes : currentMonth;
  const [overview, alerts, categories, members, months, subscribedDevices] = await Promise.all([
    getBudgetOverview(member.householdId, month),
    listAlerts(member.householdId),
    listCategories(),
    getRenderHouseholdMembers(member.householdId),
    availableMonths(householdScope(member.householdId)),
    countMemberSubscriptions(member.memberId),
  ]);
  const isCurrent = month === currentMonth;
  const monthOptions = [currentMonth, ...months.filter((m) => m < currentMonth)];
  const expenseCategories = categories.filter((category) => category.kind === "expense");
  const categoryIds = new Map(categories.map((category) => [category.slug, category.id]));

  return (
    <>
      <PageHeader
        title="Metas"
        description="Limites de gasto por mês. O Kalu avisa quando o consumo chega perto ou passa do limite."
        action={
          <Button asChild variant="outline">
            <Link href="/historico">Histórico de alterações</Link>
          </Button>
        }
      />

      <section className="flex flex-col gap-4 rounded-2xl border bg-card p-5 sm:p-6">
        <form action="/metas" className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="mes">Mês</Label>
            <select id="mes" name="mes" defaultValue={month} className={selectClassName}>
              {monthOptions.map((option) => (
                <option key={option} value={option}>
                  {formatMonth(option)}
                </option>
              ))}
            </select>
          </div>
          <Button type="submit" variant="outline">
            Ver mês
          </Button>
        </form>
        <p className="text-sm text-muted-foreground">
          O consumo da meta é o mesmo do Início: compras menos estornos, pela data da compra, no mês inteiro. Transferências
          e pagamentos de fatura não contam.
        </p>
      </section>

      <Panel title={`Metas de ${formatMonth(month)}`} icon={Target}>
        {overview.length === 0 ? (
          <p className="text-muted-foreground">
            {isCurrent ? "Nenhuma meta ainda. Crie a primeira abaixo." : "Nenhuma meta valia neste mês."}
          </p>
        ) : (
          <ul className="flex flex-col divide-y">
            {overview.map(({ goal, label, progress }) => (
              <GoalProgressItem key={goal.id} goal={goal} label={label} progress={progress}>
                <span className="text-xs text-muted-foreground">
                  Avisos em {goal.thresholds.map((t) => `${t}%`).join(", ")} · desde {formatMonth(goal.startsMonth)}
                  {goal.endsMonth && ` até ${formatMonth(goal.endsMonth)}`}
                </span>
                {isCurrent && (
                  <details className="group mt-1">
                    <summary className="w-fit cursor-pointer text-xs font-medium text-primary underline-offset-4 hover:underline">
                      Editar meta
                    </summary>
                    <div className="mt-4 flex flex-col gap-4 rounded-xl border p-4">
                      <GoalForm
                        categories={expenseCategories}
                        members={members}
                        goal={{
                          id: goal.id,
                          categoryId: goal.categorySlug ? (categoryIds.get(goal.categorySlug) ?? "") : "",
                          expense: expenseChoiceOf(goal),
                          limit: limitInput(goal.limitCents),
                          thresholds: goal.thresholds.join(", "),
                        }}
                      />
                      <RemoveGoalButton goalId={goal.id} />
                    </div>
                  </details>
                )}
              </GoalProgressItem>
            ))}
          </ul>
        )}
      </Panel>

      {isCurrent && (
        <Panel title="Nova meta" icon={Plus}>
          <GoalForm categories={expenseCategories} members={members} />
          <p className="mt-4 text-xs text-muted-foreground">
            A meta vale a partir deste mês e se repete todo mês. Mudar o valor depois não altera os meses anteriores. Use
            &quot;Para quem&quot; para metas só da Casa, do que é compartilhado ou de um integrante.
          </p>
        </Panel>
      )}

      <Panel title="Avisos" icon={BellRing}>
        <div className="mb-5">
          <PushToggle publicKey={vapidPublicKey()} subscribedDevices={subscribedDevices} />
        </div>
        {alerts.length === 0 ? (
          <p className="text-muted-foreground">Nenhum aviso ainda.</p>
        ) : (
          <ul className="flex flex-col divide-y">
            {alerts.map((alert) => (
              <li key={alert.id} className="flex flex-col gap-1 py-3 text-sm first:pt-0 last:pb-0">
                <span>
                  <strong className="font-medium">{alert.label}</strong>{" "}
                  {alert.threshold >= 100 ? `passou de ${alert.threshold}%` : `chegou a ${alert.threshold}%`} da meta de{" "}
                  {formatMonth(alert.month)}
                </span>
                <span className="text-xs text-muted-foreground">
                  {formatDateTime(alert.triggeredAt)} · <Money value={fromCents(alert.consumedCents)} /> de{" "}
                  <Money value={fromCents(alert.limitCents)} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}

export default function GoalsPage(props: PageProps<"/metas">) {
  return (
    <div className="flex flex-col gap-8">
      <Suspense fallback={<p className="text-muted-foreground">Carregando…</p>}>
        <GoalsContent searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}
