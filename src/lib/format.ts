const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export function formatBRL(value: number) {
  return brl.format(Object.is(value, -0) ? 0 : value);
}

const dateFormat = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "America/Sao_Paulo" });
const timeFormat = new Intl.DateTimeFormat("pt-BR", { timeStyle: "short", timeZone: "America/Sao_Paulo" });

export function formatDate(date: Date) {
  return dateFormat.format(date);
}

export function formatDateTime(date: Date) {
  return `${dateFormat.format(date)} às ${timeFormat.format(date)}`;
}

const listFormat = new Intl.ListFormat("pt-BR", { style: "long", type: "conjunction" });

export function formatTransactionChanges(changes: { created: number; updated: number; removed: number }) {
  const parts = (
    [
      [changes.created, "nova", "novas"],
      [changes.updated, "alterada", "alteradas"],
      [changes.removed, "removida", "removidas"],
    ] as const
  )
    .filter(([total]) => total > 0)
    .map(([total, singular, plural], index) => {
      const noun = index === 0 ? ` ${total === 1 ? "transação" : "transações"}` : "";
      return `${total}${noun} ${total === 1 ? singular : plural}`;
    });
  return parts.length === 0 ? "nenhuma transação nova ou alterada" : listFormat.format(parts);
}

export function formatIsoDate(isoDate: string) {
  const [year, month, day] = isoDate.split("-");
  return `${day}/${month}/${year}`;
}

const monthFormatter = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });

export function formatMonth(isoMonth: string) {
  const [year, month] = isoMonth.split("-").map(Number);
  return monthFormatter.format(new Date(Date.UTC(year, month - 1, 15)));
}
