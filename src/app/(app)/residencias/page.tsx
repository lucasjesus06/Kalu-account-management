import type { Metadata } from "next";
import { Suspense } from "react";
import { House, Users } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Panel } from "@/components/panel";
import { StatusBadge } from "@/components/status-badge";
import { formatDate } from "@/lib/format";
import { getCurrentProfile } from "@/server/auth";
import { listManagedHouseholds } from "@/server/households";
import {
  CreateHouseholdForm,
  InviteButton,
  LeaveHouseholdButton,
  RemoveMemberButton,
  RevokeInviteButton,
  TransferAdminButton,
} from "./household-forms";

export const metadata: Metadata = {
  title: "Residências · Kalu",
};

async function HouseholdsContent() {
  const profile = await getCurrentProfile();
  const households = await listManagedHouseholds(profile.memberId);

  return (
    <div className="grid items-start gap-4 lg:grid-cols-2">
      {households.map((household) => {
        const isAdmin = household.role === "admin";
        return (
          <Panel key={household.id} title={household.name} icon={House}>
            <div className="flex flex-col gap-6">
              <ul className="flex flex-col divide-y">
                {household.members.map((member) => (
                  <li key={member.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                    <span className="flex items-center gap-2">
                      <span className="font-medium">{member.displayName}</span>
                      {member.id === profile.memberId && <span className="text-xs text-muted-foreground">você</span>}
                      <StatusBadge tone={member.role === "admin" ? "success" : "neutral"}>
                        {member.role === "admin" ? "Administrador" : "Integrante"}
                      </StatusBadge>
                    </span>
                    {isAdmin && member.id !== profile.memberId && (
                      <span className="flex flex-wrap items-start justify-end gap-2">
                        <TransferAdminButton householdId={household.id} memberId={member.id} />
                        <RemoveMemberButton householdId={household.id} memberId={member.id} />
                      </span>
                    )}
                  </li>
                ))}
              </ul>

              <p className="text-sm text-muted-foreground">
                Entrar numa residência não compartilha nenhuma conta. Cada pessoa escolhe em Conexões o que aparece aqui.
              </p>

              {isAdmin && (
                <div className="flex flex-col gap-4 border-t pt-6">
                  <h3 className="font-semibold">Convidar</h3>
                  <InviteButton householdId={household.id} />
                  {household.invites.length > 0 && (
                    <ul className="flex flex-col divide-y text-sm">
                      {household.invites.map((invite) => (
                        <li key={invite.id} className="flex items-center justify-between gap-3 py-2">
                          <span className="text-muted-foreground">Convite pendente até {formatDate(invite.expiresAt)}</span>
                          <RevokeInviteButton inviteId={invite.id} />
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              <div className="flex flex-col gap-2 border-t pt-6">
                <LeaveHouseholdButton householdId={household.id} />
                <p className="text-xs text-muted-foreground">
                  {isAdmin && household.members.length > 1
                    ? "Para sair, passe antes a administração para outro integrante."
                    : household.members.length === 1
                      ? "Você é o único integrante: sair encerra a residência, com as metas e o histórico dela. Suas contas continuam com você."
                      : "As contas que você compartilhou com esta residência voltam a ser só suas."}
                </p>
              </div>
            </div>
          </Panel>
        );
      })}

      <Panel title="Nova residência" icon={Users}>
        <p className="mb-5 text-sm text-muted-foreground">
          Uma residência reúne contas que as pessoas decidirem compartilhar, sem tirar nada do espaço de cada uma. Você pode participar de
          várias e usar o Kalu normalmente sem nenhuma.
        </p>
        <CreateHouseholdForm />
      </Panel>
    </div>
  );
}

export default function HouseholdsPage() {
  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Residências" description="Quem participa, convites e o que cada residência enxerga." />
      <Suspense fallback={<p className="text-muted-foreground">Carregando…</p>}>
        <HouseholdsContent />
      </Suspense>
    </div>
  );
}
