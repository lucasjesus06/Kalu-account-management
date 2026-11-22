"use client";

import { useActionState, useState } from "react";
import { Copy, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { FormState } from "../conexoes/actions";
import { FormFeedback } from "../conexoes/form-feedback";
import {
  createHouseholdAction,
  createInviteAction,
  leaveHouseholdAction,
  removeMemberAction,
  revokeInviteAction,
  transferAdminAction,
  type InviteState,
} from "./actions";

export function CreateHouseholdForm() {
  const [state, formAction, pending] = useActionState<FormState, FormData>(createHouseholdAction, null);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <Label htmlFor="household-name">Nome da residência</Label>
      <div className="flex items-center gap-2">
        <Input id="household-name" name="name" maxLength={60} required placeholder="Ex.: Casa da praia" />
        <Button type="submit" disabled={pending}>
          {pending ? "Criando…" : "Criar"}
        </Button>
      </div>
      <FormFeedback state={state} />
    </form>
  );
}

export function InviteButton({ householdId }: { householdId: string }) {
  const [state, formAction, pending] = useActionState<InviteState, FormData>(createInviteAction, null);
  const [copied, setCopied] = useState(false);
  const link = state?.ok ? `${window.location.origin}/convite?codigo=${state.token}` : "";

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="householdId" value={householdId} />
      <div>
        <Button type="submit" variant="outline" size="sm" disabled={pending}>
          <Link2 />
          {pending ? "Gerando…" : "Gerar link de convite"}
        </Button>
      </div>
      {state && !state.ok && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      {state?.ok && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Input readOnly value={link} aria-label="Link do convite" onFocus={(event) => event.currentTarget.select()} />
            <Button type="button" variant="outline" size="icon" onClick={copy} aria-label="Copiar link">
              <Copy />
            </Button>
          </div>
          <p role="status" className="text-xs text-muted-foreground">
            {copied ? "Link copiado. " : ""}Vale por 7 dias e só pode ser usado uma vez. Ele não aparece de novo depois que você sair desta tela.
          </p>
        </div>
      )}
    </form>
  );
}

export function RevokeInviteButton({ inviteId }: { inviteId: string }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(revokeInviteAction, null);

  return (
    <form action={formAction} className="flex flex-col items-end gap-1">
      <input type="hidden" name="inviteId" value={inviteId} />
      <Button type="submit" variant="ghost" size="sm" disabled={pending}>
        Cancelar
      </Button>
      <FormFeedback state={state} />
    </form>
  );
}

function ConfirmButton({
  action,
  fields,
  label,
  confirmLabel,
  pendingLabel,
  variant = "outline",
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  fields: Record<string, string>;
  label: string;
  confirmLabel: string;
  pendingLabel: string;
  variant?: "outline" | "destructive";
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, null);
  const [confirming, setConfirming] = useState(false);

  return (
    <form action={formAction} className="flex flex-col items-end gap-2">
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {confirming ? (
        <div key="confirmar" className="flex flex-wrap items-center justify-end gap-2">
          <Button type="submit" variant="destructive" size="sm" disabled={pending}>
            {pending ? pendingLabel : confirmLabel}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(false)}>
            Voltar
          </Button>
        </div>
      ) : (
        <Button key="acao" type="button" variant={variant} size="sm" onClick={() => setConfirming(true)}>
          {label}
        </Button>
      )}
      <FormFeedback state={state} />
    </form>
  );
}

export function RemoveMemberButton({ householdId, memberId }: { householdId: string; memberId: string }) {
  return (
    <ConfirmButton
      action={removeMemberAction}
      fields={{ householdId, memberId }}
      label="Remover"
      confirmLabel="Confirmar remoção"
      pendingLabel="Removendo…"
    />
  );
}

export function TransferAdminButton({ householdId, memberId }: { householdId: string; memberId: string }) {
  return (
    <ConfirmButton
      action={transferAdminAction}
      fields={{ householdId, memberId }}
      label="Tornar administrador"
      confirmLabel="Confirmar transferência"
      pendingLabel="Transferindo…"
    />
  );
}

export function LeaveHouseholdButton({ householdId }: { householdId: string }) {
  return (
    <ConfirmButton
      action={leaveHouseholdAction}
      fields={{ householdId }}
      label="Sair da residência"
      confirmLabel="Confirmar saída"
      pendingLabel="Saindo…"
    />
  );
}
