import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowRight, History } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Panel } from "@/components/panel";
import {
  changeFilters,
  changeKindLabel,
  changeScopeLabel,
  parseChangeFilter,
} from "@/domain/change-log";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/format";
import { getCurrentMember } from "@/server/auth";
import { listChanges } from "@/server/change-log";

export const metadata: Metadata = {
  title: "Histórico de alterações · Kalu",
};

async function HistoryContent({ searchParams }: Pick<PageProps<"/historico">, "searchParams">) {
  const member = await getCurrentMember();
  if (!member) {
    return <p className="text-muted-foreground">Sua conta ainda não está vinculada a uma residência.</p>;
  }

  const { tipo } = await searchParams;
  const filter = parseChangeFilter(tipo);
  const changes = await listChanges(member.householdId, filter);

  return (
    <>
      <nav aria-label="Filtrar histórico" className="flex flex-wrap gap-2">
        {changeFilters.map((option) => (
          <Link
            key={option.value}
            href={option.value === "todas" ? "/historico" : `/historico?tipo=${option.value}`}
            aria-current={option.value === filter ? "page" : undefined}
            className={cn(
              "rounded-xl border px-3.5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground",
              option.value === filter && "bg-secondary text-foreground",
            )}
          >
            {option.label}
          </Link>
        ))}
      </nav>

      <Panel title="Alterações" icon={History}>
        {changes.length === 0 ? (
          <p className="text-muted-foreground">Nenhuma alteração registrada ainda.</p>
        ) : (
          <ul className="flex flex-col divide-y">
            {changes.map((change) => (
              <li key={change.id} className="flex flex-col gap-1.5 py-4 text-sm first:pt-0 last:pb-0">
                <span>
                  <strong className="font-medium">{changeKindLabel(change.kind)}</strong> · {change.subject}
                </span>
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  {change.previousValue !== null && <span className="text-muted-foreground">{change.previousValue}</span>}
                  {change.previousValue !== null && change.newValue !== null && (
                    <ArrowRight className="size-3.5 text-muted-foreground" aria-label="mudou para" />
                  )}
                  {change.newValue !== null && <span>{change.newValue}</span>}
                </span>
                <span className="text-xs text-muted-foreground">
                  {formatDateTime(change.occurredAt)} · {change.memberName ?? "Integrante removido"}
                  {changeScopeLabel(change.scope) && ` · ${changeScopeLabel(change.scope)}`}
                  {change.affectedCount > 1 && ` · ${change.affectedCount} transações`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}

export default function HistoryPage(props: PageProps<"/historico">) {
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Histórico de alterações"
        description="Quem mudou a classificação das transações e as metas, quando e qual era o valor anterior."
      />
      <Suspense fallback={<p className="text-muted-foreground">Carregando…</p>}>
        <HistoryContent searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}
