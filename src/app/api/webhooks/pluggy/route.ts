import { after } from "next/server";
import { isAuthenticWebhook, SIGNATURE_HEADER, WEBHOOK_SECRET_HEADER } from "@/server/webhook-auth";
import { parseWebhookPayload, processWebhookEvent, recordWebhookEvent } from "@/server/webhooks";

export const maxDuration = 300;

export async function POST(request: Request) {
  const rawBody = await request.text();
  const authentic = isAuthenticWebhook(
    { secret: request.headers.get(WEBHOOK_SECRET_HEADER), signature: request.headers.get(SIGNATURE_HEADER) },
    rawBody,
  );
  if (!authentic) {
    return Response.json({ error: "Não autorizado." }, { status: 401 });
  }

  const payload = parseWebhookPayload(rawBody);
  if (!payload) {
    return Response.json({ error: "Notificação inválida." }, { status: 400 });
  }

  const recordId = await recordWebhookEvent(payload);
  if (recordId) {
    after(() => processWebhookEvent(recordId, payload));
  }
  return Response.json({ received: true, duplicate: !recordId });
}
