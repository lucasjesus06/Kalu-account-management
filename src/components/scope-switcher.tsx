import { PERSONAL_CHOICE, scopeChoice } from "@/domain/scope";
import { setScopeAction } from "@/app/(app)/escopo/actions";
import { getRenderContext } from "@/server/auth";
import { ScopeSelect } from "./scope-select";

export async function ScopeSwitcher() {
  const { households, scope } = await getRenderContext();
  if (households.length === 0) {
    return null;
  }

  const options = [
    { value: PERSONAL_CHOICE, label: "Pessoal" },
    ...households.map((link) => ({ value: link.householdId, label: link.householdName })),
  ];

  return <ScopeSelect action={setScopeAction} value={scopeChoice(scope)} options={options} />;
}
