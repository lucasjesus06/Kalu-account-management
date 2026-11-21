import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Money } from "@/components/money";
import { cn } from "@/lib/utils";

export function StatCard({
  label,
  icon: Icon,
  value,
  note,
  valueClassName,
}: {
  label: string;
  icon: LucideIcon;
  value: number;
  note?: ReactNode;
  valueClassName?: string;
}) {
  return (
    <section className="rounded-2xl border bg-card p-5 text-card-foreground sm:p-6">
      <h2 className="flex items-center gap-2 text-xs font-semibold tracking-[0.12em] text-muted-foreground uppercase">
        <Icon className="size-4 text-primary" />
        {label}
      </h2>
      <Money value={value} className={cn("mt-3 block font-display text-3xl font-bold", valueClassName)} />
      {note && <p className="mt-2 text-sm text-muted-foreground">{note}</p>}
    </section>
  );
}
