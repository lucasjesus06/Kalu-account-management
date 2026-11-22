import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AddDialog } from "@/components/add-dialog";
import { getCurrentContext } from "@/server/auth";
import { listCategories } from "@/server/categorization";
import { listKnownMerchants, listRules } from "@/server/rules";
import { CategoryRuleRow, NatureRuleRow, NewRuleForm } from "./rule-forms";

export const metadata: Metadata = {
  title: "Regras · Kalu",
};

async function RulesContent() {
  const { household } = await getCurrentContext();

  const intro = (
    <div className="flex flex-col gap-2">
      <h2 className="font-display text-xl font-bold">Regras</h2>
      <p className="max-w-prose text-muted-foreground">
        Uma regra classifica sozinha as transações de um estabelecimento, hoje e nas próximas sincronizações. O que você ajusta à mão numa
        transação sempre vale mais que uma regra.
      </p>
    </div>
  );

  if (!household) {
    return (
      <>
        {intro}
        <p className="text-muted-foreground">
          As regras ficam dentro de uma residência. Escolha uma no seletor do topo ou{" "}
          <Link href="/configuracoes/familia" className="font-medium text-primary underline-offset-4 hover:underline">
            crie uma em Família
          </Link>
          .
        </p>
      </>
    );
  }

  const [rules, categories, merchants] = await Promise.all([
    listRules(household.householdId),
    listCategories(),
    listKnownMerchants(household.householdId),
  ]);

  return (
    <>
      {intro}
      <p className="text-sm text-muted-foreground">Regras da residência {household.householdName}.</p>

      <section className="flex flex-col gap-4">
        <h3 className="font-display text-lg font-bold">Categoria</h3>
        {rules.category.length === 0 ? (
          <p className="text-muted-foreground">Nenhuma regra de categoria ainda. Toque em + para criar.</p>
        ) : (
          <ul className="flex flex-col divide-y">
            {rules.category.map((rule) => (
              <CategoryRuleRow key={rule.id} rule={rule} categories={categories} />
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-4 border-t pt-8">
        <h3 className="font-display text-lg font-bold">Para quem</h3>
        {rules.nature.length === 0 ? (
          <p className="text-muted-foreground">Nenhuma regra de para quem ainda. Toque em + para criar.</p>
        ) : (
          <ul className="flex flex-col divide-y">
            {rules.nature.map((rule) => (
              <NatureRuleRow key={rule.id} rule={rule} members={rules.members} />
            ))}
          </ul>
        )}
      </section>

      <AddDialog label="Nova regra" title="Nova regra">
        <NewRuleForm categories={categories} members={rules.members} merchants={merchants} />
      </AddDialog>
    </>
  );
}

export default function RulesPage() {
  return (
    <Suspense fallback={<p className="text-muted-foreground">Carregando…</p>}>
      <RulesContent />
    </Suspense>
  );
}
