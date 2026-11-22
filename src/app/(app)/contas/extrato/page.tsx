import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowDownLeft, ArrowLeft, ArrowLeftRight, ArrowUpRight, List, Receipt } from "lucide-react";
import { Money } from "@/components/money";
import { PageHeader } from "@/components/page-header";
import { Panel } from "@/components/panel";
import { StatCard } from "@/components/stat-card";
import { fromCents } from "@/domain/money";
import { statementNature } from "@/domain/statement";
import { formatMonth } from "@/lib/format";
import { cn } from "@/lib/utils";
import { getCurrentContext, listHouseholdMembers } from "@/server/auth";
import { listCategories } from "@/server/categorization";
import { getAccountStatement } from "@/server/statement";
import { CategoryCorrectionProvider } from "../category-correction";
import { TransactionRow } from "../transaction-row";

export const metadata: Metadata = {
  title: "Extrato · Kalu",
};

async function StatementContent({ searchParams }: Pick<PageProps<"/contas/extrato">, "searchParams">) {
  const { scope, household } = await getCurrentContext();

  const { conta, mes } = await searchParams;
  const [statement, categories, members] = await Promise.all([
    getAccountStatement(scope, typeof conta === "string" ? conta : "", typeof mes === "string" ? mes : undefined),
    listCategories(),
    household ? listHouseholdMembers(household.householdId) : [],
  ]);
  if (!statement) {
    notFound();
  }

  const { account, months, selectedMonth, lines, summary } = statement;

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

      {months.length > 0 && (
        <nav aria-label="Meses do extrato" className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <ul className="flex gap-2">
            {months.map((month) => {
              const active = month === selectedMonth;
              return (
                <li key={month} className="shrink-0">
                  <Link
                    href={`/contas/extrato?conta=${account.id}&mes=${month}`}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "block rounded-xl border px-3.5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground",
                      active && "border-transparent bg-secondary text-foreground",
                    )}
                  >
                    {formatMonth(month)}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Entradas" icon={ArrowDownLeft} value={fromCents(summary.incomeCents)} valueClassName="text-success" />
        <StatCard label="Gastos" icon={ArrowUpRight} value={fromCents(summary.spendingCents)} valueClassName="text-primary" />
        <StatCard
          label="Transferências enviadas"
          icon={ArrowLeftRight}
          value={fromCents(summary.transfersOutCents)}
          note={
            <>
              Recebidas <Money value={fromCents(summary.transfersInCents)} />
            </>
          }
        />
        <StatCard label="Pagamentos de fatura" icon={Receipt} value={fromCents(summary.billPaymentsCents)} />
      </div>

      <p className="text-sm text-muted-foreground">
        Transferências entre integrantes ou entre contas próprias e pagamentos de fatura não entram nos gastos: as compras do
        cartão já são contadas na fatura. Datas pelo horário de Brasília.
      </p>

      <CategoryCorrectionProvider categories={categories} members={members}>
        <Panel title="Movimentações" icon={List}>
          {lines.length === 0 ? (
            <p className="text-muted-foreground">Nenhuma movimentação importada nesta conta.</p>
          ) : (
            <ul className="flex flex-col divide-y">
              {lines.map((line) => (
                <TransactionRow
                  key={line.id}
                  line={line}
                  variant="statement"
                  fallbackLabel={statementNature(line) === "bill_payment" ? "Pagamento de fatura" : undefined}
                />
              ))}
            </ul>
          )}
        </Panel>
      </CategoryCorrectionProvider>
    </>
  );
}

export default function StatementPage(props: PageProps<"/contas/extrato">) {
  return (
    <div className="flex flex-col gap-8">
      <Suspense fallback={<p className="text-muted-foreground">Carregando…</p>}>
        <StatementContent searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}
