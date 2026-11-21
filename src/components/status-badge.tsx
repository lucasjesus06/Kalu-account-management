import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const tones = {
  success: "bg-success/15 text-success",
  warning: "bg-warning/15 text-warning",
  danger: "bg-destructive/15 text-destructive",
  neutral: "bg-secondary text-muted-foreground",
} as const;

export function StatusBadge({ tone, children }: { tone: keyof typeof tones; children: ReactNode }) {
  return (
    <span className={cn("inline-flex items-center rounded-lg px-2.5 py-1 text-xs font-semibold", tones[tone])}>
      {children}
    </span>
  );
}
