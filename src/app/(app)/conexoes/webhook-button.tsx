"use client";

import { useActionState } from "react";
import { BellRing } from "lucide-react";
import { Button } from "@/components/ui/button";
import { registerWebhookAction, type FormState } from "./actions";
import { FormFeedback } from "./form-feedback";

export function WebhookButton({ active, disabled }: { active: boolean; disabled: boolean }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(registerWebhookAction, null);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <Button type="submit" variant="outline" size="sm" disabled={disabled || pending} className="self-start">
        <BellRing />
        {pending ? "Ativando…" : active ? "Reativar notificações" : "Ativar notificações"}
      </Button>
      <FormFeedback state={state} />
    </form>
  );
}
