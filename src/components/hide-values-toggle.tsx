"use client";

import { useSyncExternalStore } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HIDE_VALUES_CLASS, HIDE_VALUES_STORAGE_KEY } from "@/lib/privacy";

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}

function isHidden() {
  return document.documentElement.classList.contains(HIDE_VALUES_CLASS);
}

export function HideValuesToggle() {
  const hidden = useSyncExternalStore(subscribe, isHidden, () => false);

  function toggle() {
    const next = !hidden;
    document.documentElement.classList.toggle(HIDE_VALUES_CLASS, next);
    try {
      localStorage.setItem(HIDE_VALUES_STORAGE_KEY, next ? "1" : "0");
    } catch {
      return;
    }
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={toggle}
      aria-pressed={hidden}
      aria-label={hidden ? "Mostrar valores" : "Ocultar valores"}
      title={hidden ? "Mostrar valores" : "Ocultar valores"}
    >
      {hidden ? <EyeOff /> : <Eye />}
    </Button>
  );
}
