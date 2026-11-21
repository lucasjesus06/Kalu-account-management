"use client";

import { useActionState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { syncConnectionAction, type FormState } from "./actions";
import { FormFeedback } from "./form-feedback";

export function SyncButton({ connectionId }: { connectionId: string }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(syncConnectionAction, null);

  return (
    <form action={formAction} className="flex flex-col items-end gap-2">
      <input type="hidden" name="connectionId" value={connectionId} />
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        <RefreshCw className={cn(pending && "animate-spin")} />
        {pending ? "Sincronizando…" : "Sincronizar agora"}
      </Button>
      <FormFeedback state={state} />
    </form>
  );
}
