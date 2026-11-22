"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import type { FormState } from "../conexoes/actions";
import { FormFeedback } from "../conexoes/form-feedback";
import { acceptInviteAction } from "./actions";

export function AcceptForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(acceptInviteAction, null);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="token" value={token} />
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Entrando…" : "Entrar na residência"}
        </Button>
      </div>
      <FormFeedback state={state} />
    </form>
  );
}
