import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { getRenderProfile } from "@/server/auth";
import { listHouseholdLinks } from "@/server/profiles";
import { listOwnAccounts } from "@/server/sharing";
import { ShareAccountForm } from "./share-account-form";

export const metadata: Metadata = {
  title: "Compartilhamento · Kalu",
};

const kindLabels = { checking: "Conta corrente", savings: "Poupança", credit_card: "Cartão de crédito", other: "Outra conta" } as const;

async function SharingContent() {
  const profile = await getRenderProfile();
  const [accounts, households] = await Promise.all([listOwnAccounts(profile.memberId), listHouseholdLinks(profile.memberId)]);

  return (
    <>
      <div className="flex flex-col gap-2">
        <h2 className="font-display text-xl font-bold">Compartilhamento</h2>
        <p className="max-w-prose text-muted-foreground">
          Suas contas são só suas. Escolha quais aparecem para uma residência: ela só enxerga o que você marcar aqui, e você desfaz quando
          quiser. Seus dados continuam com você.
        </p>
      </div>

      {accounts.length === 0 ? (
        <p className="text-muted-foreground">
          Você ainda não tem contas importadas.{" "}
          <Link href="/conexoes" className="font-medium text-primary underline-offset-4 hover:underline">
            Conectar um banco
          </Link>
        </p>
      ) : households.length === 0 ? (
        <p className="text-muted-foreground">
          Você não participa de nenhuma residência, então tudo fica só com você.{" "}
          <Link href="/configuracoes/familia" className="font-medium text-primary underline-offset-4 hover:underline">
            Ver Família
          </Link>
        </p>
      ) : (
        <ul className="flex flex-col divide-y">
          {accounts.map((account) => (
            <li key={account.id} className="py-4 first:pt-0">
              <ShareAccountForm
                accountId={account.id}
                label={`${account.institutionName ?? "Instituição"} · ${account.name}`}
                detail={`${kindLabels[account.kind]}${account.numberLast4 ? ` ••${account.numberLast4}` : ""}`}
                value={account.sharedHouseholdId ?? ""}
                households={households.map((link) => ({ id: link.householdId, name: link.householdName }))}
              />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export default function SharingPage() {
  return (
    <Suspense fallback={<p className="text-muted-foreground">Carregando…</p>}>
      <SharingContent />
    </Suspense>
  );
}
