export const PASSWORD_MIN_LENGTH = 8;
export const DISPLAY_NAME_MAX = 60;

export function parseDisplayName(value: unknown) {
  const name = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  return name.length > 0 && name.length <= DISPLAY_NAME_MAX ? name : null;
}

export function validatePasswordChange(current: string, next: string, confirmation: string) {
  if (!current) {
    return "Informe a senha atual.";
  }
  if (next.length < PASSWORD_MIN_LENGTH) {
    return `A nova senha precisa ter pelo menos ${PASSWORD_MIN_LENGTH} caracteres.`;
  }
  if (next !== confirmation) {
    return "A confirmação não é igual à nova senha.";
  }
  if (next === current) {
    return "A nova senha precisa ser diferente da atual.";
  }
  return null;
}
