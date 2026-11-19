"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveCredentialsAction, type FormState } from "./actions";
import { FormFeedback } from "./form-feedback";

export function CredentialsForm({ hasCredentials }: { hasCredentials: boolean }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(saveCredentialsAction, null);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="clientId">Client ID</Label>
        <Input id="clientId" name="clientId" autoComplete="off" spellCheck={false} required />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="clientSecret">Client Secret</Label>
        <Input
          id="clientSecret"
          name="clientSecret"
          type="password"
          autoComplete="off"
          spellCheck={false}
          required
        />
      </div>

      <FormFeedback state={state} />

      <Button type="submit" disabled={pending}>
        {pending ? "Validando na Pluggy…" : hasCredentials ? "Substituir credenciais" : "Salvar credenciais"}
      </Button>
    </form>
  );
}
