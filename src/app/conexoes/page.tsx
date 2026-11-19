import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { getCurrentMember } from "@/server/auth";
import { getCredentialsSummary, listConnections } from "@/server/connections";
import { ConnectionForm } from "./connection-form";
import { CredentialsForm } from "./credentials-form";

export const metadata: Metadata = {
  title: "Conexões · Kalu",
};

const statusLabels = {
  active: "Ativa",
  expired: "Expirada",
  revoked: "Revogada",
  error: "Com erro",
} as const;

const dateFormat = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeZone: "America/Sao_Paulo",
});

async function ConnectionsContent() {
  const member = await getCurrentMember();

  if (!member) {
    return (
      <p className="text-sm text-muted-foreground">Sua conta ainda não está vinculada a uma residência.</p>
    );
  }

  const [credentials, connections] = await Promise.all([
    getCredentialsSummary(member.memberId),
    listConnections(member.memberId),
  ]);

  return (
    <>
      <section className="flex flex-col gap-4 rounded-lg border bg-card p-5 text-card-foreground">
        <div className="flex flex-col gap-1">
          <h2 className="font-medium">Credenciais da Pluggy</h2>
          <p className="text-sm text-muted-foreground">
            {credentials
              ? `Client ID ${credentials.clientId.slice(0, 8)}… · atualizadas em ${dateFormat.format(credentials.updatedAt)}`
              : "Informe o Client ID e o Client Secret da sua aplicação no Dashboard da Pluggy."}
          </p>
        </div>
        <CredentialsForm hasCredentials={Boolean(credentials)} />
      </section>

      <section className="flex flex-col gap-4 rounded-lg border bg-card p-5 text-card-foreground">
        <div className="flex flex-col gap-1">
          <h2 className="font-medium">Bancos conectados</h2>
          <p className="text-sm text-muted-foreground">
            Cada banco conectado no Meu Pluggy aparece como um item em Connected Items, no Dashboard da Pluggy.
          </p>
        </div>

        {connections.length > 0 && (
          <ul className="flex flex-col divide-y rounded-md border">
            {connections.map((connection) => (
              <li key={connection.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <span className="font-medium">{connection.institutionName ?? "Instituição"}</span>
                <span className="text-muted-foreground">{statusLabels[connection.status]}</span>
              </li>
            ))}
          </ul>
        )}

        <ConnectionForm disabled={!credentials} />
      </section>
    </>
  );
}

export default function ConnectionsPage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-6 py-12">
      <header className="flex flex-col gap-2">
        <Link href="/" className="text-sm text-muted-foreground">
          ← Início
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Conexões</h1>
      </header>

      <Suspense fallback={<p className="text-sm text-muted-foreground">Carregando…</p>}>
        <ConnectionsContent />
      </Suspense>
    </main>
  );
}
