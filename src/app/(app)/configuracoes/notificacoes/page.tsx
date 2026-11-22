import type { Metadata } from "next";
import { Suspense } from "react";
import { getCurrentProfile } from "@/server/auth";
import { countMemberSubscriptions, vapidPublicKey } from "@/server/push";
import { PushToggle } from "../../metas/push-toggle";

export const metadata: Metadata = {
  title: "Notificações · Kalu",
};

async function NotificationsContent() {
  const profile = await getCurrentProfile();
  const subscribedDevices = await countMemberSubscriptions(profile.memberId);

  return (
    <>
      <div className="flex flex-col gap-2">
        <h2 className="font-display text-xl font-bold">Notificações</h2>
        <p className="max-w-prose text-muted-foreground">
          Receba no celular o aviso de quando o consumo chega perto ou passa do limite de uma meta da residência. A permissão vale só para este
          dispositivo, então ative em cada aparelho que quiser.
        </p>
      </div>
      <PushToggle publicKey={vapidPublicKey()} subscribedDevices={subscribedDevices} />
    </>
  );
}

export default function NotificationsPage() {
  return (
    <Suspense fallback={<p className="text-muted-foreground">Carregando…</p>}>
      <NotificationsContent />
    </Suspense>
  );
}
