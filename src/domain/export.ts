import { consumptionCents, consumptionNature, type ConsumptionRecord } from "./consumption";
import type { ExpenseNature } from "./expense-nature";
import type { Cents } from "./money";
import { dateOf, monthOf } from "./periods";

export type ExportFormat = "csv" | "excel";

const natureLabels = {
  spending: "consumo",
  refund: "estorno",
  income: "entrada",
  transfer: "transferencia",
  bill_payment: "pagamento_fatura",
} as const;

const accountKindLabels: Record<string, string> = {
  checking: "conta_corrente",
  savings: "poupanca",
  credit_card: "cartao_credito",
  other: "outra",
};

const categoryKindLabels = { expense: "consumo", transfer: "transferencia" } as const;
const categorySourceLabels = { automatic: "automatica", rule: "regra", user: "usuario" } as const;
const expenseNatureLabels: Record<ExpenseNature, string> = {
  household: "domestica",
  shared: "compartilhada",
  individual: "individual",
};

export const exportColumns = [
  "id",
  "data",
  "mes",
  "data_hora_utc",
  "valor",
  "consumo",
  "natureza",
  "direcao",
  "situacao",
  "descricao_original",
  "estabelecimento",
  "categoria",
  "tipo_categoria",
  "origem_categoria",
  "categoria_fonte",
  "para_quem",
  "participantes",
  "origem_para_quem",
  "conta",
  "tipo_conta",
  "instituicao",
  "titular",
  "fatura_vencimento",
  "parcela",
  "total_parcelas",
] as const;

function decimal(cents: Cents, format: ExportFormat) {
  const value = (cents / 100).toFixed(2);
  return format === "excel" ? value.replace(".", ",") : value;
}

function escape(value: string, separator: string) {
  const isFormula = /^[=+\-@]/.test(value) && !/^-?\d/.test(value);
  const safe = isFormula ? `'${value}` : value;
  const needsQuotes = isFormula || safe.includes(separator) || /["\r\n]/.test(safe);
  return needsQuotes ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function participants(record: ConsumptionRecord, memberNames: readonly string[]) {
  if (record.expenseNature === "individual") {
    return record.expenseMemberName ?? "";
  }
  return record.expenseNature ? memberNames.join("|") : "";
}

export function toCsv(
  records: readonly ConsumptionRecord[],
  billTotals: readonly Cents[],
  format: ExportFormat,
  memberNames: readonly string[],
) {
  const separator = format === "excel" ? ";" : ",";
  const rows = records.map((record) => {
    const nature = consumptionNature(record, billTotals);
    const values = [
      record.id,
      dateOf(record.occurredAt),
      monthOf(record.occurredAt),
      record.occurredAt.toISOString(),
      decimal(record.amountCents, format),
      decimal(consumptionCents(record, nature), format),
      natureLabels[nature],
      record.direction === "inflow" ? "entrada" : "saida",
      record.status === "pending" ? "pendente" : "lancada",
      record.description,
      record.merchantName ?? "",
      record.category?.name ?? "",
      record.category ? categoryKindLabels[record.category.kind] : "",
      record.categorySource ? categorySourceLabels[record.categorySource] : "",
      record.providerCategory ?? "",
      record.expenseNature ? expenseNatureLabels[record.expenseNature] : "",
      participants(record, memberNames),
      record.expenseNatureSource ? categorySourceLabels[record.expenseNatureSource] : "",
      record.accountName,
      accountKindLabels[record.accountKind] ?? record.accountKind,
      record.institutionName ?? "",
      record.memberName,
      record.billDueDate ?? "",
      record.installmentNumber?.toString() ?? "",
      record.installmentTotal?.toString() ?? "",
    ];
    return values.map((value) => escape(value, separator)).join(separator);
  });
  return `﻿${[exportColumns.join(separator), ...rows].join("\r\n")}\r\n`;
}
