import Link from "next/link";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { getCurrentMember } from "@/server/auth";
import { signOut } from "./login/actions";

const proximasEtapas = [
  "Sincronização de contas, cartões e faturas",
  "Fatura do cartão por categoria",
  "Correção de categorias e participantes",
];

async function MemberGreeting() {
  const member = await getCurrentMember();

  if (!member) {
    return (
      <p className="text-sm text-muted-foreground">
        Sua conta ainda não está vinculada a uma residência.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <p className="text-sm text-muted-foreground">{member.householdName}</p>
      <p className="text-lg font-medium">Olá, {member.displayName}</p>
    </div>
  );
}

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-8 px-6 py-12">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-3xl font-semibold tracking-tight">Kalu</h1>
        <form action={signOut}>
          <Button type="submit" variant="outline" size="sm">
            Sair
          </Button>
        </form>
      </header>

      <Suspense fallback={<p className="text-sm text-muted-foreground">Carregando…</p>}>
        <MemberGreeting />
      </Suspense>

      <Button asChild variant="outline" size="lg">
        <Link href="/conexoes">Gerenciar conexões</Link>
      </Button>

      <section className="rounded-lg border bg-card p-5 text-card-foreground">
        <h2 className="font-medium">Em construção</h2>
        <ul className="mt-3 flex flex-col gap-2 text-sm text-muted-foreground">
          {proximasEtapas.map((etapa) => (
            <li key={etapa} className="flex items-center gap-2">
              <span className="size-1.5 rounded-full bg-muted-foreground" />
              {etapa}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
