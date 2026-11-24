"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { removeOwnCredentialsAction, saveOwnCredentialsAction, type FormState } from "./actions";
import { FormFeedback } from "./form-feedback";

export function OwnConnectionForm({ clientId }: { clientId: string | null }) {
  const [saveState, saveAction, saving] = useActionState<FormState, FormData>(saveOwnCredentialsAction, null);
  const [removeState, removeAction, removing] = useActionState<FormState>(removeOwnCredentialsAction, null);

  if (clientId) {
    return (
      <form action={removeAction} className="flex flex-col gap-3">
        <p className="text-sm">
          Sua conexão própria está ativa (Client ID terminado em <span className="font-medium">{clientId.slice(-6)}</span>). Os bancos
          que você adicionar passam por ela.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="outline" size="sm" disabled={removing}>
            {removing ? "Removendo…" : "Remover conexão própria"}
          </Button>
          <FormFeedback state={removeState} />
        </div>
      </form>
    );
  }

  return (
    <form action={saveAction} className="flex flex-col gap-4">
      <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
        <li>Entre no painel da Pluggy e crie a sua conta e uma aplicação.</li>
        <li>Copie o Client ID e o Client Secret da aplicação.</li>
        <li>Cole aqui. O Kalu confere com a Pluggy antes de salvar.</li>
      </ol>
      <div className="flex flex-col gap-2">
        <Label htmlFor="clientId">Client ID</Label>
        <Input id="clientId" name="clientId" autoComplete="off" required />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="clientSecret">Client Secret</Label>
        <Input id="clientSecret" name="clientSecret" type="password" autoComplete="off" required />
      </div>
      <p className="text-sm text-muted-foreground">
        O Client Secret fica guardado criptografado e nunca é mostrado de novo. Você pode gerar outro na Pluggy quando quiser. Só dá
        para trocar antes de adicionar o primeiro banco.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={saving}>
          {saving ? "Conferindo…" : "Salvar conexão própria"}
        </Button>
        <FormFeedback state={saveState} />
      </div>
    </form>
  );
}
