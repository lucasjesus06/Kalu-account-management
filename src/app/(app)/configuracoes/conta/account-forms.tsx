"use client";

import { useActionState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { FormState } from "../../conexoes/actions";
import { FormFeedback } from "../../conexoes/form-feedback";
import { changePasswordAction, renameProfileAction } from "./actions";

export function RenameForm({ name }: { name: string }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(renameProfileAction, null);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <Label htmlFor="profile-name">Nome</Label>
      <div className="flex items-center gap-2">
        <Input id="profile-name" name="name" defaultValue={name} maxLength={60} required />
        <Button type="submit" variant="outline" disabled={pending}>
          {pending ? "Salvando…" : "Salvar"}
        </Button>
      </div>
      <FormFeedback state={state} />
    </form>
  );
}

export function PasswordForm() {
  const [state, formAction, pending] = useActionState<FormState, FormData>(changePasswordAction, null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok) {
      formRef.current?.reset();
    }
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="flex max-w-sm flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="password-current">Senha atual</Label>
        <Input id="password-current" name="current" type="password" autoComplete="current-password" required />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="password-next">Nova senha</Label>
        <Input id="password-next" name="next" type="password" autoComplete="new-password" minLength={8} required />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="password-confirmation">Repita a nova senha</Label>
        <Input id="password-confirmation" name="confirmation" type="password" autoComplete="new-password" minLength={8} required />
      </div>
      <FormFeedback state={state} />
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Trocando…" : "Trocar senha"}
        </Button>
      </div>
    </form>
  );
}
