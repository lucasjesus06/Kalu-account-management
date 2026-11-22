"use client";

import { useEffect, useState, useTransition } from "react";
import { BellOff, BellRing } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { FormState } from "../conexoes/actions";
import { FormFeedback } from "../conexoes/form-feedback";
import { removePushSubscriptionAction, savePushSubscriptionAction } from "./actions";

type Status = "checking" | "unsupported" | "denied" | "off" | "on";

function applicationServerKey(publicKey: string) {
  const padded = `${publicKey}${"=".repeat((4 - (publicKey.length % 4)) % 4)}`.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

function supported() {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

async function currentSubscription() {
  const registration = await navigator.serviceWorker.getRegistration("/sw.js");
  return registration ? registration.pushManager.getSubscription() : null;
}

export function PushToggle({ publicKey, subscribedDevices }: { publicKey: string | null; subscribedDevices: number }) {
  const [status, setStatus] = useState<Status>("checking");
  const [state, setState] = useState<FormState>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let active = true;
    const detect = async (): Promise<Status> => {
      if (!publicKey || !supported()) {
        return "unsupported";
      }
      if (Notification.permission === "denied") {
        return "denied";
      }
      return (await currentSubscription()) ? "on" : "off";
    };
    detect().then((next) => active && setStatus(next));
    return () => {
      active = false;
    };
  }, [publicKey]);

  function enable() {
    setState(null);
    startTransition(async () => {
      try {
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          setStatus(permission === "denied" ? "denied" : "off");
          setState({ ok: false, error: "A permissão para notificações não foi concedida." });
          return;
        }
        const registration = await navigator.serviceWorker.register("/sw.js");
        await navigator.serviceWorker.ready;
        const subscription =
          (await registration.pushManager.getSubscription()) ??
          (await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: applicationServerKey(publicKey!),
          }));
        const result = await savePushSubscriptionAction(subscription.toJSON());
        setState(result);
        if (result?.ok) {
          setStatus("on");
        }
      } catch {
        setState({ ok: false, error: "Não foi possível ativar as notificações neste aparelho." });
      }
    });
  }

  function disable() {
    setState(null);
    startTransition(async () => {
      try {
        const subscription = await currentSubscription();
        if (subscription) {
          await removePushSubscriptionAction(subscription.endpoint);
          await subscription.unsubscribe();
        }
        setStatus("off");
        setState({ ok: true, message: "Notificações desativadas neste aparelho." });
      } catch {
        setState({ ok: false, error: "Não foi possível desativar as notificações neste aparelho." });
      }
    });
  }

  if (status === "checking") {
    return null;
  }

  return (
    <div className="flex flex-col gap-3">
      {status === "unsupported" && (
        <p className="text-sm text-muted-foreground">
          {publicKey
            ? "Este navegador não permite notificações. No iPhone, instale o Kalu na tela inicial e abra por lá."
            : "As notificações ainda não foram configuradas no servidor."}
        </p>
      )}
      {status === "denied" && (
        <p className="text-sm text-muted-foreground">
          As notificações estão bloqueadas neste navegador. Libere nas configurações do site para receber os avisos.
        </p>
      )}
      {status === "off" && (
        <Button type="button" variant="outline" size="sm" className="self-start" disabled={pending} onClick={enable}>
          <BellRing />
          {pending ? "Ativando…" : "Ativar avisos neste aparelho"}
        </Button>
      )}
      {status === "on" && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm">Avisos ativos neste aparelho.</span>
          <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={disable}>
            <BellOff />
            {pending ? "Desativando…" : "Desativar"}
          </Button>
        </div>
      )}
      {subscribedDevices > 0 && status !== "on" && (
        <p className="text-xs text-muted-foreground">
          Você tem {subscribedDevices === 1 ? "1 aparelho" : `${subscribedDevices} aparelhos`} com avisos ativos.
        </p>
      )}
      <FormFeedback state={state} />
    </div>
  );
}
