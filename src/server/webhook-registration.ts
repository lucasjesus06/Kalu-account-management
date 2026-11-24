import "server-only";
import { ensureWebhook, PluggyAuthError, PluggyRequestError } from "@/integrations/pluggy/client";
import type { ActionResult } from "./connections";
import { appApiKey, forgetAppApiKey, PluggyNotConfiguredError } from "./pluggy-app";
import { WEBHOOK_SECRET_HEADER } from "./webhook-auth";

export const WEBHOOK_PATH = "/api/webhooks/pluggy";

export function webhookUrl(env: Record<string, string | undefined> = process.env) {
  const base = env.APP_URL || (env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : "");
  if (!base) {
    return null;
  }
  try {
    const url = new URL(WEBHOOK_PATH, base);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export async function registerWebhook(memberId?: string): Promise<ActionResult> {
  const secret = process.env.PLUGGY_WEBHOOK_SECRET;
  if (!secret) {
    return { ok: false, error: "Configure a variável PLUGGY_WEBHOOK_SECRET antes de ativar as notificações." };
  }
  const url = webhookUrl();
  if (!url) {
    return { ok: false, error: "As notificações precisam do Kalu publicado em HTTPS. Configure APP_URL com o endereço publicado." };
  }

  try {
    await ensureWebhook(await appApiKey(memberId), url, { [WEBHOOK_SECRET_HEADER]: secret });
  } catch (error) {
    if (error instanceof PluggyNotConfiguredError) {
      return { ok: false, error: "A conexão com bancos ainda não foi ativada neste ambiente." };
    }
    if (error instanceof PluggyAuthError) {
      forgetAppApiKey();
      return { ok: false, error: "A Pluggy recusou as credenciais do Kalu." };
    }
    if (error instanceof PluggyRequestError && error.status === 400) {
      return { ok: false, error: `A Pluggy recusou o endereço ${url}. Ele precisa ser público e em HTTPS.` };
    }
    console.error("Falha ao cadastrar webhook na Pluggy", error);
    return { ok: false, error: "Não foi possível falar com a Pluggy agora. Tente novamente em instantes." };
  }
  return { ok: true, message: "Notificações da Pluggy ativadas." };
}
