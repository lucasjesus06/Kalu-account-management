import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { House } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Panel } from "@/components/panel";
import { getInvitePreview } from "@/server/households";
import { AcceptForm } from "./accept-form";

export const metadata: Metadata = {
  title: "Convite · Kalu",
};

const unavailable = {
  used: "Este convite já foi usado.",
  revoked: "Este convite foi cancelado.",
  expired: "Este convite expirou.",
} as const;

async function InviteContent({ searchParams }: Pick<PageProps<"/convite">, "searchParams">) {
  await connection();
  const { codigo } = await searchParams;
  const token = typeof codigo === "string" ? codigo : "";
  const invite = token ? await getInvitePreview(token) : null;

  if (!invite) {
    return <p className="text-muted-foreground">Convite não encontrado. Confira o link com quem convidou você.</p>;
  }

  return (
    <Panel title={invite.householdName} icon={House}>
      {invite.status === "usable" ? (
        <div className="flex flex-col gap-5">
          <p>
            <strong>{invite.inviterName}</strong> convidou você para a residência <strong>{invite.householdName}</strong>.
          </p>
          <p className="text-sm text-muted-foreground">
            Entrar não compartilha nenhuma conta sua e não dá acesso às contas de ninguém. Você decide depois, em Conexões, o que aparece
            na residência, e pode sair quando quiser.
          </p>
          <AcceptForm token={token} />
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <p>{unavailable[invite.status]} Peça um novo link a quem administra a residência.</p>
          <Link href="/" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
            Ir para o início
          </Link>
        </div>
      )}
    </Panel>
  );
}

export default function InvitePage(props: PageProps<"/convite">) {
  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Convite" description="Participar de uma residência." />
      <Suspense fallback={<p className="text-muted-foreground">Carregando…</p>}>
        <InviteContent searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}
