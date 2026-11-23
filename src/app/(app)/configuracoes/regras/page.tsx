import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AddDialog } from "@/components/add-dialog";
import { getRenderContext } from "@/server/auth";
import { listCategories } from "@/server/categorization";
import { listKnownMerchants, listRules } from "@/server/rules";
import { CategoryRuleRow, NatureRuleRow, NewRuleForm } from "./rule-forms";

export const metadata: Metadata = {
  title: "Regras · Kalu",
};

async function RulesContent() {
  const { profile, household, scope } = await getRenderContext();
  const [rules, categories, merchants] = await Promise.all([
    listRules(profile.memberId, household?.householdId ?? null),
    listCategories(),
    listKnownMerchants(scope),
  ]);

  return (
    <>
      <div className="flex flex-col gap-2">
        <h2 className="font-display text-xl font-bold">Regras</h2>
        <p className="max-w-prose text-muted-foreground">
          Uma regra classifica sozinha as transações de um estabelecimento, hoje e nas próximas sincronizações. O que você ajusta à mão numa
          transação sempre vale mais que uma regra, e suas regras pessoais valem mais que as da residência.
        </p>
      </div>

      <section className="flex flex-col gap-4">
        <h3 className="font-display text-lg font-bold">Minhas regras de categoria</h3>
        <p className="text-sm text-muted-foreground">Valem só nas contas que você conectou.</p>
        {rules.personal.length === 0 ? (
          <p className="text-muted-foreground">Nenhuma regra ainda. Toque em + para criar.</p>
        ) : (
          <ul className="flex flex-col divide-y">
            {rules.personal.map((rule) => (
              <CategoryRuleRow key={rule.id} rule={rule} categories={categories} target="pessoal" />
            ))}
          </ul>
        )}
      </section>

      {household ? (
        <>
          <section className="flex flex-col gap-4 border-t pt-8">
            <h3 className="font-display text-lg font-bold">Categoria na residência {household.householdName}</h3>
            <p className="text-sm text-muted-foreground">Valem nas contas compartilhadas com a residência, exceto onde o dono tem regra própria.</p>
            {rules.category.length === 0 ? (
              <p className="text-muted-foreground">Nenhuma regra de categoria ainda.</p>
            ) : (
              <ul className="flex flex-col divide-y">
                {rules.category.map((rule) => (
                  <CategoryRuleRow key={rule.id} rule={rule} categories={categories} target="casa" />
                ))}
              </ul>
            )}
          </section>

          <section className="flex flex-col gap-4 border-t pt-8">
            <h3 className="font-display text-lg font-bold">Para quem na residência {household.householdName}</h3>
            {rules.nature.length === 0 ? (
              <p className="text-muted-foreground">Nenhuma regra de para quem ainda.</p>
            ) : (
              <ul className="flex flex-col divide-y">
                {rules.nature.map((rule) => (
                  <NatureRuleRow key={rule.id} rule={rule} members={rules.members} />
                ))}
              </ul>
            )}
          </section>
        </>
      ) : (
        <p className="border-t pt-8 text-muted-foreground">
          Regras de para quem e regras compartilhadas existem dentro de uma residência.{" "}
          <Link href="/configuracoes/familia" className="font-medium text-primary underline-offset-4 hover:underline">
            Crie uma em Família
          </Link>
          .
        </p>
      )}

      <AddDialog label="Nova regra" title="Nova regra">
        <NewRuleForm categories={categories} members={rules.members} merchants={merchants} hasHousehold={Boolean(household)} />
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
