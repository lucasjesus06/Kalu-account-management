import { fromCents } from "./money";

export const changeKinds = [
  "category_changed",
  "expense_changed",
  "goal_created",
  "goal_updated",
  "goal_removed",
  "account_shared",
  "account_unshared",
  "member_joined",
  "member_left",
  "member_removed",
  "admin_transferred",
] as const;
export type ChangeKind = (typeof changeKinds)[number];

export const changeScopes = ["transaction", "merchant", "merchant_history"] as const;
export type ChangeScope = (typeof changeScopes)[number];

const kindLabels: Record<ChangeKind, string> = {
  category_changed: "Categoria alterada",
  expense_changed: "Para quem alterado",
  goal_created: "Meta criada",
  goal_updated: "Meta alterada",
  goal_removed: "Meta removida",
  account_shared: "Conta compartilhada",
  account_unshared: "Compartilhamento removido",
  member_joined: "Integrante entrou",
  member_left: "Integrante saiu",
  member_removed: "Integrante removido",
  admin_transferred: "Administração transferida",
};

const scopeLabels: Record<ChangeScope, string> = {
  transaction: "Somente nesta transação",
  merchant: "Nesta e nas próximas deste estabelecimento",
  merchant_history: "Em todas deste estabelecimento, inclusive as anteriores",
};

export type ChangeFilter = "todas" | "classificacao" | "metas" | "compartilhamento" | "integrantes";

export const changeFilters: { value: ChangeFilter; label: string; kinds: readonly ChangeKind[] }[] = [
  { value: "todas", label: "Todas", kinds: changeKinds },
  { value: "classificacao", label: "Classificação", kinds: ["category_changed", "expense_changed"] },
  { value: "metas", label: "Metas", kinds: ["goal_created", "goal_updated", "goal_removed"] },
  { value: "compartilhamento", label: "Compartilhamento", kinds: ["account_shared", "account_unshared"] },
  { value: "integrantes", label: "Integrantes", kinds: ["member_joined", "member_left", "member_removed", "admin_transferred"] },
];

export function parseChangeFilter(value: unknown): ChangeFilter {
  return changeFilters.find((filter) => filter.value === value)?.value ?? "todas";
}

export function changeKindLabel(kind: ChangeKind) {
  return kindLabels[kind];
}

export function changeScopeLabel(scope: ChangeScope | null) {
  return scope ? scopeLabels[scope] : null;
}

export function goalSummary(limitCents: number, thresholds: readonly number[]) {
  const limit = fromCents(limitCents).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  return `${limit} por mês · avisos em ${thresholds.map((t) => `${t}%`).join(", ")}`;
}
