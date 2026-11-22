import "server-only";
import { parseDisplayName, validatePasswordChange } from "@/domain/account";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { updateDisplayName } from "./profiles";

export type AccountResult = { ok: true; message: string } | { ok: false; error: string };

export async function renameProfile(memberId: string, rawName: unknown): Promise<AccountResult> {
  const name = parseDisplayName(rawName);
  if (!name) {
    return { ok: false, error: "Informe um nome de até 60 caracteres." };
  }
  await updateDisplayName(memberId, name);
  return { ok: true, message: "Nome atualizado." };
}

export async function changePassword(email: string | null, current: string, next: string, confirmation: string): Promise<AccountResult> {
  const problem = validatePasswordChange(current, next, confirmation);
  if (problem) {
    return { ok: false, error: problem };
  }
  if (!email) {
    return { ok: false, error: "Não foi possível identificar o e-mail da conta." };
  }

  const supabase = await createSupabaseServerClient();
  const verified = await supabase.auth.signInWithPassword({ email, password: current });
  if (verified.error) {
    return { ok: false, error: "A senha atual não confere." };
  }
  const updated = await supabase.auth.updateUser({ password: next });
  if (updated.error) {
    return { ok: false, error: "Não foi possível trocar a senha agora. Tente novamente." };
  }
  return { ok: true, message: "Senha alterada." };
}
