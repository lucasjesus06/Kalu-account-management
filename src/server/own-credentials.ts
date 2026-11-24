import "server-only";
import { eq } from "drizzle-orm";
import { asService, getDb } from "@/db/client";
import { integrationConnections, pluggyCredentials } from "@/db/schema";
import { authenticate, PluggyAuthError } from "@/integrations/pluggy/client";
import type { ActionResult } from "./connections";
import { encrypt } from "./crypto";
import { forgetAppApiKey } from "./pluggy-app";
import { registerWebhook } from "./webhook-registration";

const HAS_CONNECTIONS =
  "Você já tem bancos conectados. As credenciais só podem ser trocadas antes da primeira conexão, porque cada banco fica ligado à aplicação em que foi criado.";

async function hasConnections(memberId: string) {
  return (await getDb().$count(integrationConnections, eq(integrationConnections.memberId, memberId))) > 0;
}

export async function saveOwnCredentials(memberId: string, clientIdInput: string, clientSecretInput: string): Promise<ActionResult> {
  const clientId = clientIdInput.trim();
  const clientSecret = clientSecretInput.trim();
  if (!clientId || !clientSecret) {
    return { ok: false, error: "Informe o Client ID e o Client Secret da sua aplicação na Pluggy." };
  }
  if (await asService(() => hasConnections(memberId))) {
    return { ok: false, error: HAS_CONNECTIONS };
  }

  let encrypted: string;
  try {
    encrypted = encrypt(clientSecret);
  } catch {
    return { ok: false, error: "O Kalu ainda não está preparado para guardar credenciais neste ambiente." };
  }

  try {
    await authenticate({ clientId, clientSecret });
  } catch (error) {
    if (error instanceof PluggyAuthError) {
      return { ok: false, error: "A Pluggy não aceitou essas credenciais. Confira o Client ID e o Client Secret." };
    }
    console.error("Falha ao validar credenciais na Pluggy", error);
    return { ok: false, error: "Não foi possível falar com a Pluggy agora. Tente novamente em instantes." };
  }

  await asService(() =>
    getDb()
      .insert(pluggyCredentials)
      .values({ memberId, clientId, clientSecretEncrypted: encrypted })
      .onConflictDoUpdate({
        target: pluggyCredentials.memberId,
        set: { clientId, clientSecretEncrypted: encrypted, updatedAt: new Date() },
      }),
  );
  forgetAppApiKey(clientId);
  await registerWebhook(memberId).catch(() => undefined);
  return { ok: true, message: "Sua conexão própria foi salva. Agora é só adicionar o banco." };
}

export async function removeOwnCredentials(memberId: string): Promise<ActionResult> {
  if (await asService(() => hasConnections(memberId))) {
    return { ok: false, error: HAS_CONNECTIONS };
  }
  await asService(() => getDb().delete(pluggyCredentials).where(eq(pluggyCredentials.memberId, memberId)));
  return { ok: true, message: "Conexão própria removida." };
}
