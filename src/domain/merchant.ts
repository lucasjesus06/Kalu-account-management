const INTERMEDIARY_PREFIX = /^(?:(?:DL|MP|HNA|ZP|PAYPAL|PG|PAG|EBN|EC|IFD|KEETABR|PICPAY|SUMUP|SQ)\*)+/;

export function normalizeDescription(description: string) {
  return description
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/\bPENDING\b/g, " ")
    .replace(/PARC=[\d/]*/g, " ")
    .replace(/\s*\*\s*/g, "*")
    .replace(/\s+/g, " ")
    .replace(/^\*+|\*+$/g, "")
    .trim();
}

export function merchantName(description: string) {
  const normalized = normalizeDescription(description);
  const merchant = normalized
    .replace(INTERMEDIARY_PREFIX, "")
    .replace(/\s+(?:PARC\s*)?\d{1,2}\/\d{1,2}$/, "")
    .trim();
  return merchant || normalized;
}
