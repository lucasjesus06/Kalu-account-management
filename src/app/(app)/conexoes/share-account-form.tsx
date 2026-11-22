"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { shareAccountAction, type FormState } from "./actions";
import { FormFeedback } from "./form-feedback";

const selectClassName =
  "h-9 min-w-0 flex-1 rounded-md border border-input bg-input/30 px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

export function ShareAccountForm({
  accountId,
  label,
  value,
  households,
}: {
  accountId: string;
  label: string;
  value: string;
  households: { id: string; name: string }[];
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(shareAccountAction, null);

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="accountId" value={accountId} />
      <span className="truncate text-sm font-medium">{label}</span>
      <div className="flex items-center gap-2">
        <select key={value} name="householdId" defaultValue={value} aria-label={`Compartilhar ${label}`} className={selectClassName}>
          <option value="">Privada</option>
          {households.map((household) => (
            <option key={household.id} value={household.id}>
              {household.name}
            </option>
          ))}
        </select>
        <Button type="submit" variant="outline" size="sm" disabled={pending}>
          {pending ? "Salvando…" : "Salvar"}
        </Button>
      </div>
      <FormFeedback state={state} />
    </form>
  );
}
