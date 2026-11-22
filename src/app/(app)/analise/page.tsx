import type { Metadata } from "next";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { BookOpen, Download, Gauge, List, ShieldCheck } from "lucide-react";
import { Change } from "@/components/change";
import { Money } from "@/components/money";
import { PageHeader } from "@/components/page-header";
import { Panel } from "@/components/panel";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { ComparisonRow } from "@/domain/consumption";
import { fromCents } from "@/domain/money";
import { formatDate, formatDateTime, formatMonth, formatPercent, formatPeriod } from "@/lib/format";
import { cn } from "@/lib/utils";
import { getCurrentMember } from "@/server/auth";
import { listCategories } from "@/server/categorization";
import { getConsumptionComparison } from "@/server/consumption";
import { CategoryCorrectionProvider } from "../contas/category-correction";
import { TransactionRow } from "../contas/transaction-row";

export const metadata: Metadata = {
  title: "Análise · Kalu",
};

const MERCHANT_ROWS = 15;
const selectClassName =
  "h-9 rounded-md border border-input bg-input/30 px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

function Table({ head, children }: { head: ReactNode; children: ReactNode }) {
  return (
    <div className="-mx-5 overflow-x-auto sm:-mx-6">
      <table className="w-full min-w-[40rem] text-sm tabular-nums">
        <thead className="text-left text-xs text-muted-foreground">
          <tr className="[&>th]:px-5 [&>th]:pb-3 [&>th]:font-medium sm:[&>th]:px-6 [&>th:not(:first-child)]:text-right">{head}</tr>
        </thead>
        <tbody className="divide-y border-t [&_td]:px-5 [&_td]:py-2.5 sm:[&_td]:px-6 [&_td:not(:first-child)]:text-right">
          {children}
        </tbody>
      </table>
    </div>
  );
}

function ComparisonTable({
  rows,
  labelHead,
  currentLabel,
  previousLabel,
  hrefFor,
  activeKey,
}: {
  rows: ComparisonRow[];
  labelHead: string;
  currentLabel: string;
  previousLabel: string;
  hrefFor?: (row: ComparisonRow) => string;
  activeKey?: string;
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhum consumo nos dois períodos.</p>;
  }
  return (
    <Table
      head={
        <>
          <th>{labelHead}</th>
          <th>{currentLabel}</th>
          <th>Qtd.</th>
          <th>{previousLabel}</th>
          <th>Qtd.</th>
          <th>Diferença</th>
          <th>Variação</th>
        </>
      }
    >
      {rows.map((row) => (
        <tr key={row.key} className={cn(row.key === activeKey && "bg-secondary/60")}>
          <td className="max-w-[16rem] truncate" title={row.label}>
            {hrefFor ? (
              <Link href={hrefFor(row)} scroll={false} className="hover:text-primary hover:underline">
                {row.label}
              </Link>
            ) : (
              row.label
            )}
          </td>
          <td>
            <Money value={fromCents(row.currentCents)} />
          </td>
          <td className="text-muted-foreground">{row.currentCount}</td>
          <td>
            <Money value={fromCents(row.previousCents)} />
          </td>
          <td className="text-muted-foreground">{row.previousCount}</td>
          <td>
            <Money value={fromCents(row.deltaCents)} />
          </td>
          <td>
            <Change current={row.currentCents} previous={row.previousCents} />
          </td>
        </tr>
      ))}
    </Table>
  );
}

async function AnalysisContent({ searchParams }: Pick<PageProps<"/analise">, "searchParams">) {
  const member = await getCurrentMember();
  if (!member) {
    return <p className="text-muted-foreground">Sua conta ainda não está vinculada a uma residência.</p>;
  }

  const { mes, comparar, categoria } = await searchParams;
  const [comparison, categories] = await Promise.all([
    getConsumptionComparison(
      member.householdId,
      typeof mes === "string" ? mes : undefined,
      typeof comparar === "string" ? comparar : undefined,
      new Date(),
    ),
    listCategories(),
  ]);
  const { current, previous, periods, coverage, months } = comparison;
  const currentLabel = formatPeriod(periods.current);
  const previousLabel = formatPeriod(periods.previous);
  const baseQuery = `mes=${comparison.month}&comparar=${comparison.compareTo}`;
  const selectedCategory = typeof categoria === "string" ? comparison.byCategory.find((row) => row.key === categoria) : undefined;
  const categoryRecords = selectedCategory
    ? comparison.records.filter((record) => (record.category?.slug ?? "sem-categoria") === selectedCategory.key && record.category?.kind !== "transfer")
    : [];
  const monthOptions = months.includes(comparison.month) ? months : [comparison.month, ...months];
  const compareOptions = months.includes(comparison.compareTo) ? months : [...months, comparison.compareTo];

  const indicators: { label: string; current: number; previous: number; money: boolean; neutral?: boolean }[] = [
    { label: "Consumo (compras − estornos)", current: current.consumptionCents, previous: previous.consumptionCents, money: true },
    { label: "Quantidade de compras", current: current.purchasesCount, previous: previous.purchasesCount, money: false },
    { label: "Ticket médio por compra", current: current.averageTicketCents, previous: previous.averageTicketCents, money: true },
    { label: "Estornos e créditos", current: current.refundsCents, previous: previous.refundsCents, money: true, neutral: true },
    { label: "Entradas", current: current.incomeCents, previous: previous.incomeCents, money: true, neutral: true },
    {
      label: "Transferências enviadas",
      current: current.transfersOutCents,
      previous: previous.transfersOutCents,
      money: true,
      neutral: true,
    },
    { label: "Transferências recebidas", current: current.transfersInCents, previous: previous.transfersInCents, money: true, neutral: true },
    {
      label: "Faturas pagas (recebido nos cartões)",
      current: current.billPaymentsReceivedCents,
      previous: previous.billPaymentsReceivedCents,
      money: true,
      neutral: true,
    },
    {
      label: "Pagamentos de fatura feitos pelas contas",
      current: current.billPaymentsFromAccountsCents,
      previous: previous.billPaymentsFromAccountsCents,
      money: true,
      neutral: true,
    },
    { label: "Consumo sem categoria", current: current.uncategorizedCents, previous: previous.uncategorizedCents, money: true },
    { label: "Compras pendentes", current: current.pendingCount, previous: previous.pendingCount, money: false, neutral: true },
  ];

  const uncategorizedShare =
    current.consumptionCents > 0 ? (current.uncategorizedCents / current.consumptionCents) * 100 : 0;

  return (
    <>
      <PageHeader
        title="Análise detalhada"
        description="Comparação entre dois períodos, com os dados prontos para exportar."
      />

      <section className="flex flex-col gap-4 rounded-2xl border bg-card p-5 sm:p-6">
        <form action="/analise" className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="mes">Período</Label>
            <select id="mes" name="mes" defaultValue={comparison.month} className={selectClassName}>
              {monthOptions.map((month) => (
                <option key={month} value={month}>
                  {formatMonth(month)}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="comparar">Comparar com</Label>
            <select id="comparar" name="comparar" defaultValue={comparison.compareTo} className={selectClassName}>
              {compareOptions.map((month) => (
                <option key={month} value={month}>
                  {formatMonth(month)}
                </option>
              ))}
            </select>
          </div>
          <Button type="submit">Comparar</Button>
        </form>
        <p className="text-sm text-muted-foreground">
          <strong className="text-foreground">{currentLabel}</strong> comparado com{" "}
          <strong className="text-foreground">{previousLabel}</strong>
          {periods.partial
            ? `. O mês de ${formatMonth(comparison.month)} está em andamento, então a comparação usa o mesmo intervalo de dias.`
            : "."}{" "}
          Datas pelo dia da compra ou do lançamento, no horário de Brasília.
        </p>
      </section>

      <Panel title="Indicadores" icon={Gauge}>
        <Table
          head={
            <>
              <th>Indicador</th>
              <th>{currentLabel}</th>
              <th>{previousLabel}</th>
              <th>Diferença</th>
              <th>Variação</th>
            </>
          }
        >
          {indicators.map((indicator) => (
            <tr key={indicator.label}>
              <td>{indicator.label}</td>
              <td>{indicator.money ? <Money value={fromCents(indicator.current)} /> : indicator.current}</td>
              <td>{indicator.money ? <Money value={fromCents(indicator.previous)} /> : indicator.previous}</td>
              <td>
                {indicator.money ? (
                  <Money value={fromCents(indicator.current - indicator.previous)} />
                ) : (
                  indicator.current - indicator.previous
                )}
              </td>
              <td>
                <Change current={indicator.current} previous={indicator.previous} neutral={indicator.neutral} />
              </td>
            </tr>
          ))}
        </Table>
      </Panel>

      <CategoryCorrectionProvider categories={categories}>
        <Panel title="Por categoria" icon={List}>
          <ComparisonTable
            rows={comparison.byCategory}
            labelHead="Categoria"
            currentLabel={currentLabel}
            previousLabel={previousLabel}
            hrefFor={(row) => `/analise?${baseQuery}&categoria=${row.key}#movimentacoes`}
            activeKey={selectedCategory?.key}
          />
          <p className="mt-4 text-xs text-muted-foreground">Clique numa categoria para ver as movimentações de {currentLabel}.</p>
        </Panel>

        {selectedCategory && (
          <Panel title={`Movimentações · ${selectedCategory.label} · ${currentLabel}`} icon={List}>
            <div id="movimentacoes" className="scroll-mt-24">
              {categoryRecords.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhuma movimentação desta categoria em {currentLabel}.</p>
              ) : (
                <ul className="flex flex-col divide-y">
                  {categoryRecords.map((record) => (
                    <TransactionRow key={record.id} line={record} variant="statement" />
                  ))}
                </ul>
              )}
            </div>
          </Panel>
        )}
      </CategoryCorrectionProvider>

      <Panel title="Por integrante" icon={List}>
        <ComparisonTable rows={comparison.byMember} labelHead="Integrante" currentLabel={currentLabel} previousLabel={previousLabel} />
        <p className="mt-4 text-xs text-muted-foreground">
          Integrante titular da conta ou do cartão em que a compra foi feita. Não representa quem consumiu.
        </p>
      </Panel>

      <Panel title="Por origem" icon={List}>
        <ComparisonTable rows={comparison.byOrigin} labelHead="Conta ou cartão" currentLabel={currentLabel} previousLabel={previousLabel} />
      </Panel>

      <Panel title="Maiores estabelecimentos" icon={List}>
        <ComparisonTable
          rows={comparison.byMerchant.slice(0, MERCHANT_ROWS)}
          labelHead="Estabelecimento"
          currentLabel={currentLabel}
          previousLabel={previousLabel}
        />
      </Panel>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Panel title="Qualidade dos dados" icon={ShieldCheck}>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-sm">
            <dt className="text-muted-foreground">Histórico disponível</dt>
            <dd>
              {coverage.firstTransactionAt && coverage.lastTransactionAt
                ? `${formatDate(coverage.firstTransactionAt)} a ${formatDate(coverage.lastTransactionAt)}`
                : "Sem transações"}
            </dd>
            <dt className="text-muted-foreground">Transações importadas</dt>
            <dd>{coverage.transactionsCount}</dd>
            <dt className="text-muted-foreground">Última sincronização</dt>
            <dd>{coverage.lastSyncedAt ? formatDateTime(coverage.lastSyncedAt) : "Nunca"}</dd>
            <dt className="text-muted-foreground">Consumo sem categoria</dt>
            <dd>
              {formatPercent(uncategorizedShare)} em {currentLabel} ({current.uncategorizedCount}{" "}
              {current.uncategorizedCount === 1 ? "compra" : "compras"})
            </dd>
            <dt className="text-muted-foreground">Compras pendentes</dt>
            <dd>{current.pendingCount} em {currentLabel}, podem mudar ou sumir na fonte</dd>
          </dl>
          <p className="mt-4 text-xs text-muted-foreground">
            O primeiro mês do histórico pode estar incompleto. Valores sem detalhe na fatura (encargos, por exemplo) não
            aparecem aqui; veja a tela de cada fatura.
          </p>
        </Panel>

        <Panel title="Definições" icon={BookOpen}>
          <ul className="flex flex-col gap-2 text-sm text-muted-foreground">
            <li>
              <strong className="text-foreground">Consumo</strong>: compras no cartão e saídas da conta, menos estornos e
              créditos do cartão.
            </li>
            <li>
              <strong className="text-foreground">Fora do consumo</strong>: entradas, transferências entre integrantes ou
              entre contas próprias e pagamentos de fatura.
            </li>
            <li>
              <strong className="text-foreground">Data</strong>: dia da compra ou do lançamento, no horário de Brasília. A tela
              da fatura usa o ciclo de cobrança, por isso os totais podem diferir.
            </li>
            <li>
              <strong className="text-foreground">Pagamentos de fatura</strong>: o mesmo pagamento aparece saindo da conta e
              chegando no cartão. Os dois lados são mostrados separados e nunca somados.
            </li>
            <li>
              <strong className="text-foreground">Ticket médio</strong>: valor das compras dividido pela quantidade, sem
              descontar estornos.
            </li>
            <li>
              <strong className="text-foreground">Variação</strong>: diferença sobre o período comparado; não é calculada
              quando o período comparado é zero.
            </li>
          </ul>
        </Panel>
      </div>

      <Panel title="Exportar dados" icon={Download}>
        <p className="text-sm text-muted-foreground">
          Arquivo CSV com uma linha por transação e todas as dimensões (data, valor, natureza, categoria e origem da
          classificação, conta, integrante, estabelecimento, fatura e parcela), para planilhas, ferramentas de análise e o
          contador. O dicionário de dados está no README.
        </p>
        <form action="/api/exportacao" className="mt-5 flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="exportar-mes">Período</Label>
            <select id="exportar-mes" name="mes" defaultValue={comparison.month} className={selectClassName}>
              <option value={comparison.month}>{formatMonth(comparison.month)}</option>
              <option value={comparison.compareTo}>{formatMonth(comparison.compareTo)}</option>
              <option value="">Histórico completo</option>
            </select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="exportar-formato">Formato</Label>
            <select id="exportar-formato" name="formato" defaultValue="csv" className={selectClassName}>
              <option value="csv">CSV padrão (vírgula, ponto decimal)</option>
              <option value="excel">Excel em português (ponto e vírgula, vírgula decimal)</option>
            </select>
          </div>
          <Button type="submit" variant="outline">
            <Download />
            Baixar CSV
          </Button>
        </form>
      </Panel>
    </>
  );
}

export default function AnalysisPage(props: PageProps<"/analise">) {
  return (
    <div className="flex flex-col gap-8">
      <Suspense fallback={<p className="text-muted-foreground">Carregando…</p>}>
        <AnalysisContent searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}
