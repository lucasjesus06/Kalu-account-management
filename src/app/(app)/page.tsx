import Link from "next/link";
import { Suspense } from "react";
import { ArrowDownLeft, ArrowRight, CreditCard, Landmark, PieChart, Plug, Target, Users } from "lucide-react";
import { AuthorizationNotice } from "@/components/authorization-notice";
import { Change } from "@/components/change";
import { Money } from "@/components/money";
import { PageHeader } from "@/components/page-header";
import { Panel } from "@/components/panel";
import { StatCard } from "@/components/stat-card";
import { Button } from "@/components/ui/button";
import { authorizationAlert } from "@/domain/authorization";
import { UNDEFINED_NATURE_KEY } from "@/domain/expense-nature";
import { fromCents } from "@/domain/money";
import { monthOf } from "@/domain/periods";
import { formatDateTime, formatMonth, formatPeriod } from "@/lib/format";
import { cn } from "@/lib/utils";
import { getRenderContext, getRenderHouseholdMembers } from "@/server/auth";
import { listCardBills } from "@/server/bills";
import { listConnections } from "@/server/connections";
import { getBudgetOverview } from "@/server/budget";
import { getConsumptionComparison } from "@/server/consumption";
import { GoalProgressItem } from "./metas/goal-progress";
import { InstallApp } from "./install-app";

const namesFormat = new Intl.ListFormat("pt-BR", { style: "long", type: "conjunction" });
const TOP_CATEGORIES = 5;

function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

async function HomeContent() {
  const { profile, scope, household } = await getRenderContext();
  const inHousehold = household !== null;

  const now = new Date();
  const [members, connections, comparison, cardBills, goals] = await Promise.all([
    household ? getRenderHouseholdMembers(household.householdId) : [],
    listConnections(profile.memberId),
    getConsumptionComparison(scope, undefined, undefined, now, false),
    listCardBills(scope),
    household ? getBudgetOverview(household.householdId, monthOf(now)) : [],
  ]);

  const alerts = connections.flatMap((connection) => {
    const alert = authorizationAlert(connection, now);
    return alert ? [{ id: connection.id, institution: connection.institutionName ?? "Instituição", alert }] : [];
  });
  const { current, previous, periods, coverage } = comparison;
  const hasData = coverage.transactionsCount > 0;
  const deltaCents = current.consumptionCents - previous.consumptionCents;
  const openBillsCents = [...cardBills.values()].reduce((total, bills) => total + bills.open.netCents, 0);
  const topCategories = current.byCategory.slice(0, TOP_CATEGORIES);
  const previousByCategory = new Map(previous.byCategory.map((entry) => [entry.key, entry.totalCents]));
  const previousByNature = new Map(previous.byExpenseNature.map((entry) => [entry.key, entry.totalCents]));
  const natures = current.byExpenseNature.filter((entry) => entry.key !== UNDEFINED_NATURE_KEY);
  const banks = connections.map((connection) => connection.institutionName ?? "Instituição");

  return (
    <>
      <div className="flex flex-col gap-2">
        <PageHeader
          title={capitalize(formatMonth(comparison.month))}
          description={household ? `${household.householdName} · ${namesFormat.format(members.map((m) => m.displayName))}` : "Espaço pessoal"}
        />
        {hasData && (
          <p className="text-sm text-muted-foreground">
            Valores de {formatPeriod(periods.current)}
            {coverage.lastSyncedAt && `, com dados atualizados em ${formatDateTime(coverage.lastSyncedAt)}`}.
          </p>
        )}
      </div>

      {alerts.length > 0 && (
        <div className="flex flex-col gap-3">
          {alerts.map(({ id, institution, alert }) => (
            <AuthorizationNotice key={id} institution={institution} alert={alert} />
          ))}
        </div>
      )}

      {hasData ? (
        <>
          <section className="rounded-2xl border bg-card p-6 text-card-foreground sm:p-8">
            <h2 className="text-sm text-muted-foreground">{inHousehold ? "Vocês gastaram neste mês" : "Você gastou neste mês"}</h2>
            <Money
              value={fromCents(current.consumptionCents)}
              className="mt-2 block font-display text-4xl font-bold text-primary sm:text-5xl"
            />
            <p className="mt-3 text-sm text-muted-foreground">
              {current.purchasesCount === 1 ? "1 compra" : `${current.purchasesCount} compras`}
              {previous.consumptionCents > 0 && (
                <>
                  {" · "}
                  <span className={cn("font-medium", deltaCents > 0 ? "text-warning" : "text-success")}>
                    <Money value={fromCents(Math.abs(deltaCents))} /> {deltaCents > 0 ? "a mais" : "a menos"}
                  </span>{" "}
                  que no mesmo período de {formatMonth(comparison.compareTo).split(" ")[0]} ({formatPeriod(periods.previous)})
                </>
              )}
            </p>
            <p className="mt-4 text-xs text-muted-foreground">
              Compras no cartão e na conta, menos estornos. Transferências entre vocês e pagamentos de fatura não contam.
            </p>
          </section>

          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard
              label="Entradas no mês"
              icon={ArrowDownLeft}
              value={fromCents(current.incomeCents)}
              valueClassName="text-success"
              note="Salários e outros recebimentos"
            />
            <StatCard label="Saldo em contas" icon={Landmark} value={fromCents(coverage.balanceCents)} note="Contas correntes e poupança" />
            <StatCard
              label="Faturas abertas"
              icon={CreditCard}
              value={fromCents(openBillsCents)}
              note={
                <>
                  Limite usado <Money value={fromCents(coverage.creditUsedCents)} /> de{" "}
                  <Money value={fromCents(coverage.creditLimitCents)} />
                </>
              }
            />
          </div>

          <Panel title="Onde foi o dinheiro" icon={PieChart}>
            {topCategories.length === 0 ? (
              <p className="text-muted-foreground">Nenhuma compra neste mês ainda.</p>
            ) : (
              <ul className="flex flex-col gap-4">
                {topCategories.map((category) => {
                  const share = current.consumptionCents > 0 ? (category.totalCents / current.consumptionCents) * 100 : 0;
                  return (
                    <li key={category.key} className="flex flex-col gap-2">
                      <span className="flex items-center justify-between gap-4">
                        <span className="min-w-0 truncate font-medium">{category.label}</span>
                        <span className="flex shrink-0 items-baseline gap-3">
                          <Change
                            current={category.totalCents}
                            previous={previousByCategory.get(category.key) ?? 0}
                            className="text-xs"
                          />
                          <Money value={fromCents(category.totalCents)} className="font-semibold" />
                        </span>
                      </span>
                      <span className="h-1.5 overflow-hidden rounded-full bg-secondary" role="presentation">
                        <span
                          className="block h-full rounded-full bg-primary"
                          style={{ width: `${Math.max(0, Math.round(share))}%` }}
                        />
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="mt-5 text-xs text-muted-foreground">
              Setas comparam com o mesmo período de {formatMonth(comparison.compareTo)}.
            </p>
            <Button asChild variant="outline" className="mt-5">
              <Link href="/analise">
                Ver análise detalhada
                <ArrowRight />
              </Link>
            </Button>
          </Panel>

          {inHousehold && current.consumptionCents > 0 && (
            <Panel title="Para quem foi" icon={Users}>
              {natures.length > 0 && (
                <ul className="flex flex-col divide-y">
                  {natures.map((entry) => (
                    <li key={entry.key} className="flex items-center justify-between gap-4 py-2.5">
                      <span className="min-w-0 truncate font-medium">{entry.label}</span>
                      <span className="flex shrink-0 items-baseline gap-3">
                        <Change current={entry.totalCents} previous={previousByNature.get(entry.key) ?? 0} className="text-xs" />
                        <Money value={fromCents(entry.totalCents)} className="font-semibold" />
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {current.undefinedNatureCents > 0 && (
                <p className={cn("text-sm text-muted-foreground", natures.length > 0 && "mt-4")}>
                  <Money value={fromCents(current.undefinedNatureCents)} className="font-medium text-foreground" /> ainda sem
                  definição.{" "}
                  <Link
                    href={`/analise?para=${UNDEFINED_NATURE_KEY}#movimentacoes`}
                    className="font-medium text-primary underline-offset-4 hover:underline"
                  >
                    Definir agora
                  </Link>
                </p>
              )}
              <p className="mt-4 text-xs text-muted-foreground">
                Casa são as despesas da residência, Compartilhado é o que vocês aproveitam juntos. Não importa quem pagou.
              </p>
            </Panel>
          )}

          {inHousehold && (
            <Panel title="Metas do mês" icon={Target}>
              {goals.length === 0 ? (
                <p className="text-muted-foreground">
                  Defina um limite por mês para uma categoria ou para todo o consumo, e o Kalu avisa quando chegar perto.
                </p>
              ) : (
                <ul className="flex flex-col divide-y">
                  {[...goals]
                    .sort((a, b) => b.progress.percent - a.progress.percent)
                    .map(({ goal, label, progress }) => (
                      <GoalProgressItem key={goal.id} goal={goal} label={label} progress={progress} />
                    ))}
                </ul>
              )}
              <Button asChild variant="outline" className="mt-5">
                <Link href="/metas">
                  {goals.length === 0 ? "Criar meta" : "Gerenciar metas"}
                  <ArrowRight />
                </Link>
              </Button>
            </Panel>
          )}
        </>
      ) : (
        <Panel title="Seus gastos" icon={PieChart}>
          <p className="text-muted-foreground">
            Assim que os bancos forem conectados e sincronizados, os gastos do mês aparecem aqui.
          </p>
        </Panel>
      )}

      <Panel title="Suas conexões" icon={Plug}>
        <p className="text-muted-foreground">
          {banks.length === 0
            ? "Nenhum banco conectado ainda. Conecte seus bancos para o Kalu montar suas faturas e gastos."
            : `${banks.length === 1 ? "1 banco conectado" : `${banks.length} bancos conectados`}: ${namesFormat.format(banks)}.`}
        </p>
        <Button asChild variant={banks.length === 0 ? "default" : "outline"} className="mt-5">
          <Link href="/conexoes">
            {banks.length === 0 ? "Conectar bancos" : "Gerenciar conexões"}
            <ArrowRight />
          </Link>
        </Button>
      </Panel>

      <InstallApp />
    </>
  );
}

export default function Home() {
  return (
    <div className="flex flex-col gap-8">
      <Suspense fallback={<p className="text-muted-foreground">Carregando…</p>}>
        <HomeContent />
      </Suspense>
    </div>
  );
}
