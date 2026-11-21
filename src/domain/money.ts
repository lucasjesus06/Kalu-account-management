export type Cents = number;

export function toCents(amount: number): Cents {
  if (!Number.isFinite(amount)) {
    throw new Error(`Valor monetário inválido: ${amount}`);
  }
  const cents = Math.round(amount * 100);
  return Object.is(cents, -0) ? 0 : cents;
}

export function fromCents(cents: Cents) {
  return cents / 100;
}
