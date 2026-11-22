"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useCloseAddDialog } from "@/components/add-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { FormState } from "../../conexoes/actions";
import { FormFeedback } from "../../conexoes/form-feedback";
import { changeRuleAction, deleteRuleAction, saveRuleAction } from "./actions";

type Category = { id: string; name: string; kind: "expense" | "transfer" };
type Member = { id: string; displayName: string };

const selectClassName =
  "h-9 w-full min-w-0 rounded-md border border-input bg-input/30 px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

const groups = [
  { kind: "expense", label: "Consumo" },
  { kind: "transfer", label: "Transferências (não entram no consumo)" },
] as const;

function CategoryOptions({ categories }: { categories: Category[] }) {
  return groups.map((group) => (
    <optgroup key={group.kind} label={group.label}>
      {categories
        .filter((category) => category.kind === group.kind)
        .map((category) => (
          <option key={category.id} value={category.id}>
            {category.name}
          </option>
        ))}
    </optgroup>
  ));
}

function ExpenseOptions({ members }: { members: Member[] }) {
  return (
    <>
      <option value="household">Casa (aluguel, contas, mercado)</option>
      <option value="shared">Compartilhado entre vocês</option>
      {members.map((member) => (
        <option key={member.id} value={member.id}>
          Só {member.displayName}
        </option>
      ))}
    </>
  );
}

export function NewRuleForm({ categories, members, merchants }: { categories: Category[]; members: Member[]; merchants: string[] }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(saveRuleAction, null);
  const [kind, setKind] = useState<"category" | "nature">("category");
  const close = useCloseAddDialog();

  useEffect(() => {
    if (state?.ok) {
      close();
    }
  }, [state, close]);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <fieldset className="flex gap-4 text-sm">
        <legend className="mb-2 text-sm font-medium">O que a regra define</legend>
        <label className="flex items-center gap-2">
          <input type="radio" name="kind" value="category" checked={kind === "category"} onChange={() => setKind("category")} className="accent-primary" />
          Categoria
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="kind" value="nature" checked={kind === "nature"} onChange={() => setKind("nature")} className="accent-primary" />
          Para quem
        </label>
      </fieldset>

      <div className="flex flex-col gap-2">
        <Label htmlFor="rule-merchant">Estabelecimento</Label>
        <Input id="rule-merchant" name="merchant" list="rule-merchants" maxLength={120} required placeholder="Como aparece nas transações" autoComplete="off" />
        <datalist id="rule-merchants">
          {merchants.map((merchant) => (
            <option key={merchant} value={merchant} />
          ))}
        </datalist>
      </div>

      {kind === "category" ? (
        <div key="category" className="flex flex-col gap-2">
          <Label htmlFor="rule-category">Categoria</Label>
          <select id="rule-category" name="categoryId" required defaultValue="" className={selectClassName}>
            <option value="" disabled>
              Escolha
            </option>
            <CategoryOptions categories={categories} />
          </select>
        </div>
      ) : (
        <div key="nature" className="flex flex-col gap-2">
          <Label htmlFor="rule-expense">Para quem</Label>
          <select id="rule-expense" name="expense" required defaultValue="" className={selectClassName}>
            <option value="" disabled>
              Escolha
            </option>
            <ExpenseOptions members={members} />
          </select>
        </div>
      )}

      <label className="flex items-start gap-2.5 text-sm">
        <input type="checkbox" name="applyHistory" defaultChecked className="mt-0.5 accent-primary" />
        Aplicar também às transações anteriores. Ajustes feitos só numa transação nunca são substituídos.
      </label>

      <FormFeedback state={state} />
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? "Salvando…" : "Criar regra"}
        </Button>
      </div>
    </form>
  );
}

function RuleRow({
  kind,
  ruleId,
  merchant,
  value,
  detail,
  children,
}: {
  kind: "category" | "nature";
  ruleId: string;
  merchant: string;
  value: string;
  detail: string;
  children: React.ReactNode;
}) {
  const [changeState, changeAction, changing] = useActionState<FormState, FormData>(changeRuleAction, null);
  const [deleteState, deleteAction, deleting] = useActionState<FormState, FormData>(deleteRuleAction, null);
  const [confirming, setConfirming] = useState(false);
  const changeRef = useRef<HTMLFormElement>(null);
  const name = kind === "category" ? "categoryId" : "expense";

  return (
    <li className="flex flex-col gap-2 py-4 first:pt-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-col">
          <span className="truncate font-medium">{merchant}</span>
          <span className="truncate text-xs text-muted-foreground">{detail}</span>
        </div>
        <div className="flex items-center gap-2">
          <form ref={changeRef} action={changeAction} className="flex-1 sm:w-56 sm:flex-none">
            <input type="hidden" name="kind" value={kind} />
            <input type="hidden" name="merchant" value={merchant} />
            <select
              key={value}
              name={name}
              defaultValue={value}
              disabled={changing}
              aria-label={`Regra de ${merchant}`}
              onChange={() => changeRef.current?.requestSubmit()}
              className={selectClassName}
            >
              {children}
            </select>
          </form>
          <form action={deleteAction} className="flex items-center gap-2">
            <input type="hidden" name="kind" value={kind} />
            <input type="hidden" name="ruleId" value={ruleId} />
            {confirming ? (
              <div key="confirmar" className="flex items-center gap-1">
                <Button type="submit" variant="destructive" size="sm" disabled={deleting}>
                  {deleting ? "Removendo…" : "Confirmar"}
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(false)}>
                  Voltar
                </Button>
              </div>
            ) : (
              <Button key="remover" type="button" variant="ghost" size="sm" onClick={() => setConfirming(true)}>
                Remover
              </Button>
            )}
          </form>
        </div>
      </div>
      <FormFeedback state={deleteState ?? changeState} />
    </li>
  );
}

export function CategoryRuleRow({
  rule,
  categories,
}: {
  rule: { id: string; merchantName: string; categoryId: string; createdBy: string | null };
  categories: Category[];
}) {
  return (
    <RuleRow
      kind="category"
      ruleId={rule.id}
      merchant={rule.merchantName}
      value={rule.categoryId}
      detail={rule.createdBy ? `Criada por ${rule.createdBy}` : "Criada"}
    >
      <CategoryOptions categories={categories} />
    </RuleRow>
  );
}

export function NatureRuleRow({
  rule,
  members,
}: {
  rule: { id: string; merchantName: string; choice: string; createdBy: string | null };
  members: Member[];
}) {
  return (
    <RuleRow
      kind="nature"
      ruleId={rule.id}
      merchant={rule.merchantName}
      value={rule.choice}
      detail={rule.createdBy ? `Criada por ${rule.createdBy}` : "Criada"}
    >
      <ExpenseOptions members={members} />
    </RuleRow>
  );
}
