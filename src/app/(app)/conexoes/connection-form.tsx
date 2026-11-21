"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { addConnectionAction, type FormState } from "./actions";
import { FormFeedback } from "./form-feedback";

export function ConnectionForm({ disabled }: { disabled: boolean }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(addConnectionAction, null);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="itemId">Item ID</Label>
        <Input id="itemId" name="itemId" autoComplete="off" spellCheck={false} required disabled={disabled} />
      </div>

      <FormFeedback state={state} />

      <Button type="submit" variant="outline" disabled={disabled || pending}>
        {pending ? "Validando na Pluggy…" : "Adicionar conexão"}
      </Button>
    </form>
  );
}
