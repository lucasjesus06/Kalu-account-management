import Link from "next/link";
import { Suspense } from "react";
import { ArrowRight, ListChecks, Plug } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Panel } from "@/components/panel";
import { Button } from "@/components/ui/button";
import { getCurrentMember, listHouseholdMembers } from "@/server/auth";
import { listConnections } from "@/server/connections";

const proximasEtapas = [
  "Sincronização de contas, cartões e faturas",
  "Fatura do cartão por categoria",
  "Correção de categorias e participantes",
];

const monthFormat = new Intl.DateTimeFormat("pt-BR", {
  month: "long",
  year: "numeric",
  timeZone: "America/Sao_Paulo",
});

const namesFormat = new Intl.ListFormat("pt-BR", { style: "long", type: "conjunction" });

function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

async function HomeContent() {
  const member = await getCurrentMember();

  if (!member) {
    return <PageHeader title="Kalu" description="Sua conta ainda não está vinculada a uma residência." />;
  }

  const [members, connections] = await Promise.all([
    listHouseholdMembers(member.householdId),
    listConnections(member.memberId),
  ]);

  const banks = connections.map((connection) => connection.institutionName ?? "Instituição");

  return (
    <>
      <PageHeader
        title={capitalize(monthFormat.format(new Date()))}
        description={`${member.householdName} · ${namesFormat.format(members.map((m) => m.displayName))}`}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Suas conexões" icon={Plug}>
          <p className="text-muted-foreground">
            {banks.length === 0
              ? "Nenhum banco conectado ainda. Conecte seus bancos para o Kalu montar suas faturas e gastos."
              : `${banks.length === 1 ? "1 banco conectado" : `${banks.length} bancos conectados`}: ${namesFormat.format(banks)}.`}
          </p>
          <Button asChild className="mt-5">
            <Link href="/conexoes">
              {banks.length === 0 ? "Conectar bancos" : "Gerenciar conexões"}
              <ArrowRight />
            </Link>
          </Button>
        </Panel>

        <Panel title="Próximas etapas" icon={ListChecks}>
          <ul className="flex flex-col gap-3 text-muted-foreground">
            {proximasEtapas.map((etapa) => (
              <li key={etapa} className="flex items-center gap-3">
                <span className="size-1.5 shrink-0 rounded-full bg-primary" />
                {etapa}
              </li>
            ))}
          </ul>
        </Panel>
      </div>
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
