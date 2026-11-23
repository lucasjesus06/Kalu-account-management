"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { finishConnectAction, startConnectAction, type FormState } from "./actions";
import { FormFeedback } from "./form-feedback";

type Status = "idle" | "opening" | "open" | "saving";

const labels: Record<Exclude<Status, "idle">, string> = {
  opening: "Abrindo…",
  open: "Aguardando a autorização…",
  saving: "Salvando e sincronizando…",
};

export function ConnectBankButton({
  renewConnectionId,
  disabled = false,
  hidden = false,
  variant = "default",
  children,
}: {
  renewConnectionId?: string;
  disabled?: boolean;
  hidden?: boolean;
  variant?: "default" | "outline";
  children: ReactNode;
}) {
  const [status, setStatus] = useState<Status>("idle");
  const [state, setState] = useState<FormState>(null);

  async function open() {
    setState(null);
    setStatus("opening");
    const session = await startConnectAction(renewConnectionId);
    if (!session.ok) {
      setState(session);
      setStatus("idle");
      return;
    }

    try {
      const { PluggyConnect } = await import("pluggy-connect-sdk");
      const widget = new PluggyConnect({
        connectToken: session.connectToken,
        ...(session.updateItem ? { updateItem: session.updateItem } : {}),
        ...(session.connectorId ? { selectedConnectorId: session.connectorId } : {}),
        ...(process.env.NEXT_PUBLIC_PLUGGY_CONNECT_URL ? { url: process.env.NEXT_PUBLIC_PLUGGY_CONNECT_URL } : {}),
        theme: "dark",
        language: "pt",
        onSuccess: async ({ item }) => {
          setStatus("saving");
          setState(await finishConnectAction(item.id, renewConnectionId));
          setStatus("idle");
        },
        onError: ({ message }) => {
          setState({ ok: false, error: `Não foi possível concluir a conexão: ${message}` });
        },
        onClose: () => {
          setStatus((current) => (current === "saving" ? current : "idle"));
        },
      });
      await widget.init();
      setStatus((current) => (current === "opening" ? "open" : current));
    } catch {
      setState({ ok: false, error: "Não foi possível abrir a janela de conexão. Verifique a internet e tente novamente." });
      setStatus("idle");
    }
  }

  return (
    <div className="flex flex-col gap-3 empty:hidden">
      {(!hidden || status !== "idle") && (
        <Button type="button" variant={variant} onClick={open} disabled={disabled || status !== "idle"} className="self-start">
          {status === "idle" ? children : labels[status]}
        </Button>
      )}
      <FormFeedback state={state} />
    </div>
  );
}
