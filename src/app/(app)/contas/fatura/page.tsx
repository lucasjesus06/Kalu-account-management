import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft, CircleCheck, CircleHelp, Layers, Receipt, Store, Tags, Undo2 } from "lucide-react";
import { Money } from "@/components/money";
import { PageHeader } from "@/components/page-header";
import { Panel } from "@/components/panel";
import { StatCard } from "@/components/stat-card";
import { StatusBadge } from "@/components/status-badge";
import type { BillLine } from "@/domain/bill-details";
import { fromCents } from "@/domain/money";
import { formatDate, formatIsoDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { getCurrentMember } from "@/server/auth";
import { getCardBillDetail, OPEN_CYCLE } from "@/server/bills";

export const metadata: Metadata = {
  title: "Fatura · Kalu",
};

const paymentBadges = {
  paid: { label: "Paga", tone: "success" },
  partially_paid: { label: "Parcialmente paga", tone: "warning" },
  unpaid: { label: "Em aberto", tone: "danger" },
} as const;

function plural(total: number, singular: string, pluralForm: string) {
  return `${total} ${total === 1 ? singular : pluralForm}`;
}

function TransactionRow({ line }: { line: BillLine }) {
  const isCredit = line.direction === "inflow";
  return (
    <li className="flex items-center justify-between gap-4 py-2.5 text-sm">
      <div className="flex min-w-0 flex-col">
        <span className="truncate">{line.merchantName ?? line.description}</span>
        <span className="text-xs text-muted-foreground">
          {formatDate(line.occurredAt)}
          {line.installmentNumber !== null &&
            line.installmentTotal !== null &&
            line.installmentTotal > 1 &&
            ` · parcela ${line.installmentNumber}/${line.installmentTotal}`}
          {line.status === "pending" && " · pendente"}
        </span>
      </div>
      <Money
        value={fromCents(isCredit ? -line.amountCents : line.amountCents)}
        className={cn("shrink-0", isCredit && "text-success")}
      />
    </li>
  );
}

async function BillContent({ searchParams }: Pick<PageProps<"/contas/fatura">, "searchParams">) {
  const member = await getCurrentMember();
  if (!member) {
    return <p className="text-muted-foreground">Sua conta ainda não está vinculada a uma residência.</p>;
  }

  const { cartao, ciclo } = await searchParams;
  const detail = await getCardBillDetail(
    member.householdId,
    typeof cartao === "string" ? cartao : "",
    typeof ciclo === "string" ? ciclo : undefined,
  );
  if (!detail) {
    notFound();
  }

  const { account, cycles, selected } = detail;
  const composition = selected.composition;
  const base = selected.isOpen ? composition.netCents : Math.max(selected.composition.officialTotalCents, composition.netCents);
  const unidentifiedCents = selected.isOpen ? 0 : selected.composition.unidentifiedCents;

  return (
    <>
      <div className="flex flex-col gap-4">
        <Link href="/contas" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" />
          Contas
        </Link>
        <PageHeader
          title={account.name}
          description={[account.institutionName, account.numberLast4 && `•••• ${account.numberLast4}`, account.ownerName]
            .filter(Boolean)
            .join(" · ")}
        />
      </div>

      <nav aria-label="Ciclos da fatura" className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <ul className="flex gap-2">
          {cycles.map((cycle) => {
            const active = cycle.key === selected.key;
            return (
              <li key={cycle.key} className="shrink-0">
                <Link
                  href={
                    cycle.key === OPEN_CYCLE
                      ? `/contas/fatura?cartao=${account.id}`
                      : `/contas/fatura?cartao=${account.id}&ciclo=${encodeURIComponent(cycle.key)}`
                  }
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "block rounded-xl border px-3.5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground",
                    active && "border-transparent bg-secondary text-foreground",
                  )}
                >
                  {cycle.dueDate ? `Venc. ${formatIsoDate(cycle.dueDate)}` : "Aberta"}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {selected.isOpen ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <StatCard
            label="Fatura aberta"
            icon={Receipt}
            value={fromCents(composition.netCents)}
            valueClassName="text-primary"
            note={
              <>
                Parcial: o ciclo ainda não fechou
                {composition.pendingCents > 0 && (
                  <>
                    {" "}
                    · <Money value={fromCents(composition.pendingCents)} /> pendente
                  </>
                )}
              </>
            }
          />
          <StatCard
            label="Créditos e estornos"
            icon={Undo2}
            value={fromCents(composition.creditsCents)}
            valueClassName="text-success"
            note={plural(composition.creditsCount, "crédito neste ciclo", "créditos neste ciclo")}
          />
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard
            label="Total da fatura"
            icon={Receipt}
            value={fromCents(selected.composition.officialTotalCents)}
            valueClassName="text-primary"
            note={<>Vencimento {formatIsoDate(selected.composition.dueDate)}</>}
          />
          <StatCard
            label="Pago"
            icon={CircleCheck}
            value={fromCents(selected.paidCents)}
            note={
              <span className="flex flex-wrap items-center gap-2">
                <StatusBadge tone={paymentBadges[selected.status].tone}>{paymentBadges[selected.status].label}</StatusBadge>
                {selected.status !== "paid" && (
                  <span>
                    Pendente{" "}
                    <Money value={fromCents(Math.max(0, selected.composition.officialTotalCents - selected.paidCents))} />
                  </span>
                )}
              </span>
            }
          />
          <StatCard
            label="Não identificado"
            icon={CircleHelp}
            value={fromCents(Math.max(0, unidentifiedCents))}
            note={
              unidentifiedCents < 0 ? (
                <>
                  Compras <Money value={fromCents(-unidentifiedCents)} /> acima do valor oficial
                </>
              ) : (
                "Sem detalhe na fonte, como encargos ou compras anteriores ao histórico"
              )
            }
          />
        </div>
      )}

      <p className="text-sm text-muted-foreground">
        Composição pela competência da fatura: cada compra entra no ciclo em que o banco a cobrou, não pela data da compra.
        Parcelas aparecem no ciclo em que são cobradas. O pagamento da fatura anterior não é abatido.
        {!selected.isOpen && selected.composition.incomplete && (
          <span className="mt-2 block text-warning">
            Histórico incompleto: esta é a fatura mais antiga disponível e pode ter compras anteriores ao histórico importado.
          </span>
        )}
      </p>

      <div className="grid items-start gap-4 lg:grid-cols-3">
        <Panel title="Por categoria" icon={Tags} className="lg:col-span-2">
          {detail.categories.length === 0 && unidentifiedCents <= 0 ? (
            <p className="text-muted-foreground">Nenhuma compra neste ciclo.</p>
          ) : (
            <ul className="flex flex-col divide-y">
              {detail.categories.map((group) => {
                const percent = base > 0 ? Math.max(0, Math.round((group.netCents / base) * 100)) : 0;
                return (
                  <li key={group.slug ?? "sem-categoria"}>
                    <details className="group">
                      <summary className="flex cursor-pointer list-none flex-col gap-2 py-3 [&::-webkit-details-marker]:hidden">
                        <span className="flex items-center justify-between gap-4">
                          <span className={cn("min-w-0 truncate font-medium", group.slug === null && "text-muted-foreground")}>
                            {group.name}
                          </span>
                          <span className="flex shrink-0 items-baseline gap-2">
                            <span className="text-xs text-muted-foreground">{percent}%</span>
                            <Money value={fromCents(group.netCents)} className="font-semibold" />
                          </span>
                        </span>
                        <span className="h-1.5 overflow-hidden rounded-full bg-secondary" role="presentation">
                          <span className="block h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {plural(group.count, "transação", "transações")} ·{" "}
                          <span className="group-open:hidden">ver transações</span>
                          <span className="hidden group-open:inline">ocultar</span>
                        </span>
                      </summary>
                      <ul className="mb-3 flex flex-col divide-y rounded-xl bg-secondary/40 px-4">
                        {group.lines.map((line) => (
                          <TransactionRow key={line.id} line={line} />
                        ))}
                      </ul>
                    </details>
                  </li>
                );
              })}
              {unidentifiedCents > 0 && (
                <li className="flex flex-col gap-2 py-3">
                  <span className="flex items-center justify-between gap-4">
                    <span className="font-medium text-muted-foreground">Não identificado pela fonte</span>
                    <span className="flex shrink-0 items-baseline gap-2">
                      <span className="text-xs text-muted-foreground">{Math.round((unidentifiedCents / base) * 100)}%</span>
                      <Money value={fromCents(unidentifiedCents)} className="font-semibold text-muted-foreground" />
                    </span>
                  </span>
                  <span className="h-1.5 overflow-hidden rounded-full bg-secondary" role="presentation">
                    <span
                      className="block h-full rounded-full bg-muted-foreground/50"
                      style={{ width: `${Math.round((unidentifiedCents / base) * 100)}%` }}
                    />
                  </span>
                </li>
              )}
            </ul>
          )}
        </Panel>

        <div className="flex flex-col gap-4">
          <Panel title="Maiores estabelecimentos" icon={Store}>
            {detail.merchants.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma compra neste ciclo.</p>
            ) : (
              <ol className="flex flex-col gap-3">
                {detail.merchants.map((merchant) => (
                  <li key={merchant.name} className="flex items-center justify-between gap-4 text-sm">
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate font-medium">{merchant.name}</span>
                      <span className="text-xs text-muted-foreground">{plural(merchant.count, "transação", "transações")}</span>
                    </span>
                    <Money value={fromCents(merchant.netCents)} className="shrink-0" />
                  </li>
                ))}
              </ol>
            )}
          </Panel>

          <Panel title="Créditos e estornos" icon={Undo2}>
            {detail.credits.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum crédito neste ciclo.</p>
            ) : (
              <ul className="flex flex-col divide-y">
                {detail.credits.map((line) => (
                  <TransactionRow key={line.id} line={line} />
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Parcelas futuras" icon={Layers}>
            {detail.installments.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma compra parcelada com parcelas a cobrar.</p>
            ) : (
              <>
                <ul className="flex flex-col gap-3">
                  {detail.installments.map(({ line, remaining, remainingCents }) => (
                    <li key={line.id} className="flex items-center justify-between gap-4 text-sm">
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate font-medium">{line.merchantName ?? line.description}</span>
                        <span className="text-xs text-muted-foreground">
                          Parcela {line.installmentNumber}/{line.installmentTotal} · {plural(remaining, "restante", "restantes")}
                        </span>
                      </span>
                      <Money value={fromCents(remainingCents)} className="shrink-0" />
                    </li>
                  ))}
                </ul>
                <p className="mt-4 border-t pt-4 text-xs text-muted-foreground">
                  Total de <Money value={fromCents(detail.installments.reduce((total, item) => total + item.remainingCents, 0))} />,
                  calculado a partir do valor da parcela deste ciclo.
                </p>
              </>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}

export default function BillPage(props: PageProps<"/contas/fatura">) {
  return (
    <div className="flex flex-col gap-8">
      <Suspense fallback={<p className="text-muted-foreground">Carregando…</p>}>
        <BillContent searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}
