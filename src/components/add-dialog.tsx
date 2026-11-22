"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";

const CloseContext = createContext<() => void>(() => {});

export function useCloseAddDialog() {
  return useContext(CloseContext);
}

export function AddDialog({ label, title, children }: { label: string; title: string; children: ReactNode }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [openCount, setOpenCount] = useState(0);

  function open() {
    setOpenCount((count) => count + 1);
    dialogRef.current?.showModal();
  }

  function close() {
    dialogRef.current?.close();
  }

  useEffect(() => {
    const dialog = dialogRef.current;
    const onClick = (event: MouseEvent) => {
      if (event.target === dialog) {
        dialog?.close();
      }
    };
    dialog?.addEventListener("click", onClick);
    return () => dialog?.removeEventListener("click", onClick);
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={open}
        aria-label={label}
        title={label}
        className={cn(
          "fixed right-5 bottom-24 z-30 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-black/40 transition-transform hover:scale-105 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none lg:right-8 lg:bottom-8",
        )}
      >
        <Plus className="size-6" />
      </button>
      <dialog
        ref={dialogRef}
        aria-label={title}
        className="m-auto w-[min(28rem,calc(100%-2rem))] rounded-2xl border bg-card p-6 text-foreground backdrop:bg-black/60"
      >
        <CloseContext.Provider value={close}>
          <div key={openCount} className="flex flex-col gap-5">
            <div className="flex items-start justify-between gap-4">
              <h2 className="font-display text-lg font-bold">{title}</h2>
              <button type="button" onClick={close} aria-label="Fechar" className="text-muted-foreground hover:text-foreground">
                <X className="size-5" />
              </button>
            </div>
            {children}
          </div>
        </CloseContext.Provider>
      </dialog>
    </>
  );
}
