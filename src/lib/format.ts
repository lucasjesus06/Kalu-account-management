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
