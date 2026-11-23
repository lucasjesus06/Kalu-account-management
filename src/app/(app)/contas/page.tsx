import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowRight, CreditCard, Landmark } from "lucide-react";
import { Money } from "@/components/money";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { Button } from "@/components/ui/button";
import { fromCents } from "@/domain/money";
import { formatDateTime, formatIsoDate } from "@/lib/format";
import { listAccounts } from "@/server/accounts";
import { listCardBills } from "@/server/bills";
import { getRenderContext } from "@/server/auth";

export const metadata: Metadata = {
  title: "Contas · Kalu",
};

const kindLabels = {
  checking: "Conta corrente",
  savings: "Poupança",
  credit_card: "Cartão de crédito",
  other: "Outra conta",
} as const;

function plural(total: number, singular: string, pluralForm: string) {
  return `${total} ${total === 1 ? singular : pluralForm}`;
}

async function AccountsContent() {
  const { scope } = await getRenderContext();

  const [accounts, cardBills] = await Promise.all([
    listAccounts(scope),
    listCardBills(scope),
  ]);

  if (accounts.length === 0) {
    return (
      <section className="flex flex-col items-start gap-4 rounded-2xl border bg-card p-6">
        <p className="text-muted-foreground">
          Nenhuma conta importada ainda. Sincronize suas conexões para trazer contas, cartões e faturas.
        </p>
        <Button asChild>
          <Link href="/conexoes">Ir para Conexões</Link>
        </Button>
      </section>
    );
  }

  const bankAccounts = accounts.filter((account) => account.kind !== "credit_card");
  const cards = accounts.filter((account) => account.kind === "credit_card");
  const totalBalance = bankAccounts.reduce((total, account) => total + account.balanceCents, 0);
  const totalUsed = cards.reduce((total, account) => total + (account.creditUsedCents ?? 0), 0);
  const totalLimit = cards.reduce((total, account) => total + (account.creditLimitCents ?? 0), 0);

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <StatCard label="Saldo em contas" icon={Landmark} value={fromCents(totalBalance)} note="Não inclui limite de crédito" />
        <StatCard
          label="Limite utilizado"
          icon={CreditCard}
          value={fromCents(totalUsed)}
          valueClassName="text-primary"
          note={
            <>
              de <Money value={fromCents(totalLimit)} /> · inclui parcelas futuras
            </>
          }
        />
      </div>

      <ul className="grid gap-4 lg:grid-cols-2">
        {accounts.map((account) => {
          const isCard = account.kind === "credit_card";
          const bills = cardBills.get(account.id);
          const lastBill = bills?.closed[0];
          const usedRatio =
            isCard && account.creditLimitCents
              ? Math.min(100, Math.round(((account.creditUsedCents ?? 0) / account.creditLimitCents) * 100))
              : 0;
          return (
            <li key={account.id} className="flex min-w-0 flex-col gap-5 rounded-2xl border bg-card p-5 text-card-foreground sm:p-6">
              <div className="flex items-center gap-4">
                <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-secondary text-primary">
                  {isCard ? <CreditCard className="size-5" /> : <Landmark className="size-5" />}
                </span>
                <div className="flex min-w-0 flex-col">
                  <span className="truncate font-semibold">{account.name}</span>
                  <span className="text-sm text-muted-foreground">
                    {[account.institutionName, kindLabels[account.kind], account.numberLast4 && `••••\u00a0${account.numberLast4}`, account.ownerName]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </div>
              </div>

              {isCard ? (
                <div className="flex flex-col gap-2">
                  <span className="text-sm text-muted-foreground">Limite utilizado</span>
                  <Money value={fromCents(account.creditUsedCents ?? 0)} className="font-display text-2xl font-bold text-primary" />
                  <div className="h-2 overflow-hidden rounded-full bg-secondary" role="presentation">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${usedRatio}%` }} />
                  </div>
                  <span className="text-sm text-muted-foreground">
                    Disponível <Money value={fromCents(account.creditAvailableCents ?? 0)} /> de{" "}
                    <Money value={fromCents(account.creditLimitCents ?? 0)} />
                  </span>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <span className="text-sm text-muted-foreground">Saldo</span>
                  <Money value={fromCents(account.balanceCents)} className="font-display text-2xl font-bold" />
                  <Button asChild variant="outline" size="sm" className="mt-2 self-start">
                    <Link href={`/contas/extrato?conta=${account.id}`}>
                      Ver extrato
                      <ArrowRight />
                    </Link>
                  </Button>
                </div>
              )}

              {bills && (
                <div className="flex flex-col gap-4 border-t pt-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="flex min-w-0 flex-col gap-1">
                      <span className="text-sm text-muted-foreground">Fatura aberta</span>
                      <Money value={fromCents(bills.open.netCents)} className="font-display text-lg font-bold" />
                      <span className="text-xs text-muted-foreground">
                        {plural(bills.open.purchasesCount, "compra", "compras")}
                        {bills.open.pendingCents > 0 && (
                          <>
                            {" "}
                            · <Money value={fromCents(bills.open.pendingCents)} /> pendente
                          </>
                        )}
                      </span>
                    </div>
                    {lastBill && (
                      <div className="flex min-w-0 flex-col gap-1">
                        <span className="text-sm text-muted-foreground">Última fatura</span>
                        <Money value={fromCents(lastBill.officialTotalCents)} className="font-display text-lg font-bold" />
                        <span className="text-xs text-muted-foreground">
                          Venc. {formatIsoDate(lastBill.dueDate)} ·{" "}
                          {lastBill.unidentifiedCents > 0 ? (
                            <>
                              <Money value={fromCents(lastBill.unidentifiedCents)} /> não identificado pela fonte
                            </>
                          ) : lastBill.unidentifiedCents < 0 ? (
                            <>
                              compras <Money value={fromCents(-lastBill.unidentifiedCents)} /> acima do valor oficial
                            </>
                          ) : (
                            "totalmente identificada"
                          )}
                          {lastBill.incomplete && " · histórico incompleto"}
                        </span>
                      </div>
                    )}
                  </div>
                  <Button asChild variant="outline" size="sm" className="self-start">
                    <Link href={`/contas/fatura?cartao=${account.id}`}>
                      Ver fatura por categoria
                      <ArrowRight />
                    </Link>
                  </Button>
                </div>
              )}

              <p className="border-t pt-4 text-xs text-muted-foreground">
                {plural(account.transactionsCount, "transação", "transações")}
                {isCard && ` · ${plural(account.billsCount, "fatura", "faturas")}`}
                {isCard &&
                  account.spendingCount > 0 &&
                  ` · ${Math.round((account.categorizedSpendingCount / account.spendingCount) * 100)}% das compras com categoria`}
                {account.lastSyncedAt && ` · sincronizado em ${formatDateTime(account.lastSyncedAt)}`}
              </p>
            </li>
          );
        })}
      </ul>
    </>
  );
}

export default function AccountsPage() {
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Contas"
        description="Saldos e limites das contas conectadas."
        action={
          <Button asChild variant="outline">
            <Link href="/historico">Histórico de alterações</Link>
          </Button>
        }
      />
      <Suspense fallback={<p className="text-muted-foreground">Carregando…</p>}>
        <AccountsContent />
      </Suspense>
    </div>
  );
}
