import type { Metadata } from "next";
import { Suspense } from "react";
import { KeyRound, Plug } from "lucide-react";
import { AuthorizationNotice } from "@/components/authorization-notice";
import { PageHeader } from "@/components/page-header";
import { Panel } from "@/components/panel";
import { StatusBadge } from "@/components/status-badge";
import { authorizationAlert } from "@/domain/authorization";
import { getCurrentMember } from "@/server/auth";
import { formatDate, formatDateTime, formatTransactionChanges } from "@/lib/format";
import { getCredentialsSummary, listConnections } from "@/server/connections";
import { latestSyncRuns } from "@/server/sync";
import { ConnectBankButton } from "./connect-bank-button";
import { ConnectionForm } from "./connection-form";
import { CredentialsForm } from "./credentials-form";
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
  const member = await getCurrentMember();

  if (!member) {
    return <p className="text-muted-foreground">Sua conta ainda não está vinculada a uma residência.</p>;
  }

  const [credentials, connections] = await Promise.all([
    getCredentialsSummary(member.memberId),
    listConnections(member.memberId),
  ]);
  const runs = await latestSyncRuns(connections.map((connection) => connection.id));
  const now = new Date();

  return (
    <div className="grid items-start gap-4 lg:grid-cols-2">
      <Panel
        title={connections.length === 1 ? "1 instituição" : `${connections.length} instituições`}
        icon={Plug}
      >
        {connections.length === 0 ? (
          <p className="text-muted-foreground">Nenhum banco conectado ainda.</p>
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
                      disabled={!credentials}
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

        <div className="mt-6 flex flex-col gap-4 border-t pt-6">
          <div className="flex flex-col gap-1">
            <h3 className="font-semibold">Conectar um banco</h3>
            <p className="text-sm text-muted-foreground">
              Abre a janela da Pluggy: escolha <strong className="text-foreground">MeuPluggy</strong> e autorize. O banco
              precisa estar conectado antes no Meu Pluggy. Em seguida o Kalu já sincroniza os dados.
            </p>
          </div>
          <ConnectBankButton disabled={!credentials}>Conectar banco</ConnectBankButton>
          {!credentials && (
            <p className="text-xs text-muted-foreground">Cadastre as credenciais da Pluggy para começar.</p>
          )}
          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground">Adicionar pelo Item ID</summary>
            <div className="mt-4">
              <ConnectionForm disabled={!credentials} />
            </div>
          </details>
        </div>
      </Panel>

      <Panel title="Credenciais da Pluggy" icon={KeyRound}>
        <p className="mb-5 text-sm text-muted-foreground">
          {credentials
            ? `Client ID ${credentials.clientId.slice(0, 8)}… · atualizadas em ${formatDate(credentials.updatedAt)}`
            : "Informe o Client ID e o Client Secret da sua aplicação no Dashboard da Pluggy."}
        </p>
        <CredentialsForm hasCredentials={Boolean(credentials)} />
      </Panel>
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
