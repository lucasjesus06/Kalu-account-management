"use client";

import { useActionState, useRef } from "react";
import { shareAccountAction, type FormState } from "../../conexoes/actions";
import { FormFeedback } from "../../conexoes/form-feedback";

const selectClassName =
  "h-9 w-full min-w-0 rounded-md border border-input bg-input/30 px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:w-56";

export function ShareAccountForm({
  accountId,
  label,
  detail,
  value,
  households,
}: {
  accountId: string;
  label: string;
  detail: string;
  value: string;
  households: { id: string; name: string }[];
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(shareAccountAction, null);
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="accountId" value={accountId} />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-col">
          <span className="truncate font-medium">{label}</span>
          <span className="truncate text-sm text-muted-foreground">{detail}</span>
        </div>
        <select
          key={value}
          name="householdId"
          defaultValue={value}
          disabled={pending}
          aria-label={`Onde ${label} aparece`}
          onChange={() => formRef.current?.requestSubmit()}
          className={selectClassName}
        >
          <option value="">Só eu</option>
          {households.map((household) => (
            <option key={household.id} value={household.id}>
              {household.name}
            </option>
          ))}
        </select>
      </div>
      <FormFeedback state={state} />
    </form>
  );
}
