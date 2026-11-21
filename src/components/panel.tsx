import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Panel({
  title,
  icon: Icon,
  children,
  className,
}: {
  title?: string;
  icon?: LucideIcon;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("overflow-hidden rounded-2xl border bg-card text-card-foreground", className)}>
      {title && (
        <h2 className="flex items-center gap-2 border-b px-5 py-4 text-xs font-semibold tracking-[0.12em] text-muted-foreground uppercase sm:px-6">
          {Icon && <Icon className="size-4 text-primary" />}
          {title}
        </h2>
      )}
      <div className="p-5 sm:p-6">{children}</div>
    </section>
  );
}
