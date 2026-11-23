import type { Metadata } from "next";
import { Suspense } from "react";
import { AddDialog } from "@/components/add-dialog";
import { StatusBadge } from "@/components/status-badge";
import { formatDate } from "@/lib/format";
import { getRenderProfile } from "@/server/auth";
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
  title: "Família · Kalu",
};

async function FamilyContent() {
  const profile = await getRenderProfile();
  const households = await listManagedHouseholds(profile.memberId);

  return (
    <>
      <div className="flex flex-col gap-2">
        <h2 className="font-display text-xl font-bold">Família</h2>
        <p className="max-w-prose text-muted-foreground">
          Residências reúnem as contas que cada pessoa decide compartilhar. Entrar numa residência não compartilha nada: depois você escolhe,
          em Compartilhamento, o que aparece nela.
        </p>
      </div>

      {households.length === 0 && (
        <p className="text-muted-foreground">
          Você ainda não participa de nenhuma residência. Toque em + para criar uma, ou abra um link de convite.
        </p>
      )}

      {households.map((household) => {
        const isAdmin = household.role === "admin";
        return (
          <section key={household.id} className="flex flex-col gap-6 border-t pt-8 first:border-t-0 first:pt-0">
            <h3 className="font-display text-lg font-bold">{household.name}</h3>

            <ul className="flex flex-col divide-y">
              {household.members.map((member) => (
                <li key={member.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0">
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

            {isAdmin && (
              <div className="flex flex-col gap-3">
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

            <div className="flex flex-col items-start gap-2">
              <LeaveHouseholdButton householdId={household.id} />
              <p className="text-xs text-muted-foreground">
                {isAdmin && household.members.length > 1
                  ? "Para sair, passe antes a administração para outro integrante."
                  : household.members.length === 1
                    ? "Você é o único integrante: sair encerra a residência, com as metas e o histórico dela. Suas contas continuam com você."
                    : "As contas que você compartilhou com esta residência voltam a ser só suas."}
              </p>
            </div>
          </section>
        );
      })}

      <AddDialog label="Nova residência" title="Nova residência">
        <CreateHouseholdForm />
      </AddDialog>
    </>
  );
}

export default function FamilyPage() {
  return (
    <Suspense fallback={<p className="text-muted-foreground">Carregando…</p>}>
      <FamilyContent />
    </Suspense>
  );
}
