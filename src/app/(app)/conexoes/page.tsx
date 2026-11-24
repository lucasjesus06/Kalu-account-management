import type { Metadata } from "next";
import { Suspense } from "react";
import { KeyRound, Plug } from "lucide-react";
import { AuthorizationNotice } from "@/components/authorization-notice";
import { PageHeader } from "@/components/page-header";
import { Panel } from "@/components/panel";
import { StatusBadge } from "@/components/status-badge";
import { authorizationAlert } from "@/domain/authorization";
import { getRenderProfile } from "@/server/auth";
import { formatDate, formatDateTime, formatTransactionChanges } from "@/lib/format";
import { listConnections } from "@/server/connections";
import { ownClientId, pluggyAvailableFor } from "@/server/pluggy-app";
import { latestSyncRuns } from "@/server/sync";
import { ConnectBankButton } from "./connect-bank-button";
import { OwnConnectionForm } from "./own-connection-form";
import { SyncButton } from "./sync-button";

export const metadata: Metadata = {
  title: "Conexões · Kalu",
};

const statusBadges = {
  active: { label: "Ativa", tone: "success" },
  expired: { label: "Expirada", tone: "danger" },
  revoked: { label: "Revogada", tone: "neutral" },
  error: { label: "Com erro", tone: "warning" },
} as const;

async function ConnectionsContent() {
  const member = await getRenderProfile();
  const connections = await listConnections(member.memberId);
  const [available, ownId] = await Promise.all([pluggyAvailableFor(member.memberId), ownClientId(member.memberId)]);
  const runs = await latestSyncRuns(connections.map((connection) => connection.id));
  const now = new Date();

  return (
    <div className="mx-auto w-full max-w-2xl">
      <Panel
        title={connections.length === 1 ? "1 instituição" : `${connections.length} instituições`}
        icon={Plug}
      >
        {connections.length === 0 ? (
          <div className="mb-6 flex flex-col gap-1">
            <p className="font-medium">Nenhum banco conectado ainda</p>
            <p className="text-sm text-muted-foreground">
              Adicione seu banco para o Kalu montar suas faturas e gastos. Uma janela segura abre aqui mesmo.
            </p>
            <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
              <li>Entre no seu Meu Pluggy ou crie a conta, que é gratuita.</li>
              <li>Escolha o banco e autorize o acesso.</li>
              <li>Volte ao Kalu: suas contas aparecem sozinhas.</li>
            </ol>
          </div>
        ) : (
          <ul className="flex flex-col divide-y">
            {connections.map((connection) => {
              const name = connection.institutionName ?? "Instituição";
              const badge = statusBadges[connection.status];
              const lastRun = runs.get(connection.id);
              const alert = authorizationAlert(connection, now);
              return (
                <li key={connection.id} className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0">
                  <div className="flex items-center gap-4">
                    <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-secondary font-display font-bold text-primary">
                      {name.charAt(0).toUpperCase()}
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate font-semibold">{name}</span>
                      <span className="text-sm text-muted-foreground">
                        {member.displayName} ·{" "}
                        {connection.lastSyncedAt
                          ? `sincronizado em ${formatDateTime(connection.lastSyncedAt)}`
                          : "ainda não sincronizado"}
                        {lastRun?.status === "succeeded" && ` · ${formatTransactionChanges(lastRun)}`}
                      </span>
                    </div>
                    <StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>
                  </div>
                  {alert && <AuthorizationNotice institution={name} alert={alert} showAction={false} />}
                  {connection.authorizationExpiresAt && !alert && (
                    <p className="text-sm text-muted-foreground">
                      Autorização válida até {formatDate(connection.authorizationExpiresAt)}
                    </p>
                  )}
                  {lastRun?.status === "failed" && lastRun.error && alert?.level !== "expired" && (
                    <p className="text-sm text-destructive">
                      Última tentativa em {formatDateTime(lastRun.startedAt)}: {lastRun.error}
                    </p>
                  )}
                  <div className="flex flex-wrap items-start gap-3">
                    <SyncButton connectionId={connection.id} />
                    <ConnectBankButton
                      renewConnectionId={connection.id}
                      variant="outline"
                      disabled={!available}
                      hidden={!alert && connection.status !== "expired" && connection.status !== "error"}
                    >
                      Renovar autorização
                    </ConnectBankButton>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <div className={connections.length === 0 ? "" : "mt-6 border-t pt-6"}>
          <ConnectBankButton variant={connections.length === 0 ? "default" : "outline"} disabled={!available}>
            Adicionar banco
          </ConnectBankButton>
          {!available && (
            <p className="mt-3 text-sm text-muted-foreground">A conexão com bancos ainda não foi ativada neste ambiente.</p>
          )}
        </div>
      </Panel>

      <details className="mt-6 rounded-2xl border bg-card text-card-foreground" open={ownId !== null}>
        <summary className="flex cursor-pointer items-center gap-2 px-5 py-4 text-xs font-semibold tracking-[0.12em] text-muted-foreground uppercase sm:px-6">
          <KeyRound className="size-4 text-primary" />
          Usar minha própria conexão
        </summary>
        <div className="border-t p-5 sm:p-6">
          <OwnConnectionForm clientId={ownId} />
        </div>
      </details>
    </div>
  );
}

export default function ConnectionsPage() {
  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Conexões" description="Bancos conectados via Open Finance." />
      <Suspense fallback={<p className="text-muted-foreground">Carregando…</p>}>
        <ConnectionsContent />
      </Suspense>
    </div>
  );
}
