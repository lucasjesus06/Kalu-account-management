"use client";

import { createContext, useActionState, useContext, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { FormFeedback } from "../conexoes/form-feedback";
import type { FormState } from "../conexoes/actions";
import { correctCategoryAction } from "./actions";

type Target = { transactionId: string; merchant: string; categorySlug: string | null };
type Category = { id: string; slug: string; name: string; kind: "expense" | "transfer" };

const CorrectionContext = createContext<(target: Target) => void>(() => {});

const groups = [
  { kind: "expense", label: "Consumo" },
  { kind: "transfer", label: "Transferências (não entram no consumo)" },
] as const;

const scopes = [
  { value: "transaction", label: "Somente nesta transação" },
  { value: "merchant", label: "Nesta e nas próximas deste estabelecimento" },
  { value: "merchant_history", label: "Em todas deste estabelecimento, inclusive as anteriores" },
] as const;

function CorrectionForm({ target, categories, onClose }: { target: Target; categories: Category[]; onClose: () => void }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(correctCategoryAction, null);
  const current = categories.find((category) => category.slug === target.categorySlug);

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <input type="hidden" name="transactionId" value={target.transactionId} />
      <div className="flex flex-col gap-1">
        <h2 className="font-display text-lg font-bold">Alterar categoria</h2>
        <p className="break-words text-sm text-muted-foreground">{target.merchant}</p>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="categoryId">Categoria</Label>
        <select
          id="categoryId"
          name="categoryId"
          defaultValue={current?.id ?? ""}
          className="h-9 rounded-md border border-input bg-input/30 px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <option value="">Sem categoria</option>
          {groups.map((group) => (
            <optgroup key={group.kind} label={group.label}>
              {categories
                .filter((category) => category.kind === group.kind)
                .map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">Aplicar</legend>
        {scopes.map((scope) => (
          <label key={scope.value} className="flex items-start gap-2.5 text-sm">
            <input
              type="radio"
              name="scope"
              value={scope.value}
              defaultChecked={scope.value === "transaction"}
              className="mt-0.5 accent-primary"
            />
            {scope.label}
          </label>
        ))}
        <p className="mt-1 text-xs text-muted-foreground">
          As duas últimas opções criam uma regra para a residência. Ajustes feitos só numa transação nunca são substituídos
          por regras.
        </p>
      </fieldset>

      <FormFeedback state={state} />

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose}>
          {state?.ok ? "Fechar" : "Cancelar"}
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Salvando…" : "Salvar"}
        </Button>
      </div>
    </form>
  );
}

export function CategoryCorrectionProvider({ categories, children }: { categories: Category[]; children: ReactNode }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [target, setTarget] = useState<{ value: Target; key: number } | null>(null);

  function open(value: Target) {
    setTarget((previous) => ({ value, key: (previous?.key ?? 0) + 1 }));
    dialogRef.current?.showModal();
  }

  function close() {
    dialogRef.current?.close();
  }

  return (
    <CorrectionContext.Provider value={open}>
      {children}
      <dialog
        ref={dialogRef}
        aria-label="Alterar categoria"
        className="m-auto w-[min(28rem,calc(100%-2rem))] rounded-2xl border bg-card p-6 text-foreground backdrop:bg-black/60"
      >
        {target && <CorrectionForm key={target.key} target={target.value} categories={categories} onClose={close} />}
      </dialog>
    </CorrectionContext.Provider>
  );
}

export function CorrectCategoryButton(target: Target) {
  const open = useContext(CorrectionContext);
  return (
    <button
      type="button"
      onClick={() => open(target)}
      className="text-xs font-medium text-primary underline-offset-4 hover:underline"
    >
      Alterar
    </button>
  );
}
