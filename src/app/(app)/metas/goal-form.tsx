"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { FormState } from "../conexoes/actions";
import { FormFeedback } from "../conexoes/form-feedback";
import { removeGoalAction, saveGoalAction } from "./actions";

type Option = { id: string; name: string };
type Member = { id: string; displayName: string };
export type GoalDefaults = { id: string; categoryId: string; expense: string; limit: string; thresholds: string };

const selectClassName =
  "h-9 rounded-md border border-input bg-input/30 px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

export function GoalForm({
  categories,
  members,
  goal,
}: {
  categories: Option[];
  members: Member[];
  goal?: GoalDefaults;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(saveGoalAction, null);
  const prefix = goal ? `meta-${goal.id}` : "nova-meta";

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {goal && <input type="hidden" name="goalId" value={goal.id} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${prefix}-categoria`}>Categoria</Label>
          <select
            id={`${prefix}-categoria`}
            name="categoryId"
            defaultValue={goal?.categoryId ?? ""}
            className={selectClassName}
          >
            <option value="">Todo o consumo</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${prefix}-para-quem`}>Para quem</Label>
          <select id={`${prefix}-para-quem`} name="expense" defaultValue={goal?.expense ?? ""} className={selectClassName}>
            <option value="">Todos os gastos</option>
            <option value="household">Casa</option>
            <option value="shared">Compartilhado</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                Só {member.displayName}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${prefix}-valor`}>Limite por mês (R$)</Label>
          <Input
            id={`${prefix}-valor`}
            name="limit"
            inputMode="decimal"
            autoComplete="off"
            placeholder="500,00"
            defaultValue={goal?.limit}
            required
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${prefix}-avisos`}>Avisar ao chegar em (%)</Label>
          <Input
            id={`${prefix}-avisos`}
            name="thresholds"
            inputMode="numeric"
            autoComplete="off"
            defaultValue={goal?.thresholds ?? "70, 90, 100"}
            required
          />
        </div>
      </div>

      <FormFeedback state={state} />

      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Salvando…" : goal ? "Salvar meta" : "Criar meta"}
        </Button>
      </div>
    </form>
  );
}

export function RemoveGoalButton({ goalId }: { goalId: string }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(removeGoalAction, null);
  const [confirming, setConfirming] = useState(false);

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="goalId" value={goalId} />
      {confirming ? (
        <div key="confirmar" className="flex flex-wrap items-center gap-2">
          <Button type="submit" variant="destructive" size="sm" disabled={pending}>
            {pending ? "Removendo…" : "Confirmar remoção"}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(false)}>
            Cancelar
          </Button>
        </div>
      ) : (
        <div key="remover">
          <Button type="button" variant="outline" size="sm" onClick={() => setConfirming(true)}>
            Remover meta
          </Button>
        </div>
      )}
      <FormFeedback state={state} />
    </form>
  );
}
