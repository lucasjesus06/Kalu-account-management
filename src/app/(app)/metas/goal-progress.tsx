import type { ReactNode } from "react";
import { Money } from "@/components/money";
import type { BudgetGoal, GoalProgress } from "@/domain/budget";
import { fromCents } from "@/domain/money";
import { formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

const barColors = { ok: "bg-primary", warning: "bg-warning", over: "bg-destructive" } as const;
const textColors = { ok: "text-muted-foreground", warning: "text-warning", over: "text-destructive" } as const;

export function GoalStatusText({ progress }: { progress: GoalProgress }) {
  if (progress.status === "over") {
    return (
      <>
        Passou <Money value={fromCents(-progress.remainingCents)} /> da meta ({formatPercent(progress.percent)})
      </>
    );
  }
  return (
    <>
      {formatPercent(progress.percent)} usado · faltam <Money value={fromCents(progress.remainingCents)} />
    </>
  );
}

export function GoalProgressItem({
  goal,
  label,
  progress,
  children,
}: {
  goal: BudgetGoal;
  label: string;
  progress: GoalProgress;
  children?: ReactNode;
}) {
  return (
    <li className="flex flex-col gap-2 py-4 first:pt-0 last:pb-0">
      <span className="flex items-baseline justify-between gap-4">
        <span className="min-w-0 truncate font-medium" title={label}>
          {label}
        </span>
        <span className="shrink-0 text-sm">
          <Money value={fromCents(progress.consumedCents)} className="font-semibold" />
          <span className="text-muted-foreground">
            {" de "}
            <Money value={fromCents(goal.limitCents)} />
          </span>
        </span>
      </span>
      <span
        className="h-1.5 overflow-hidden rounded-full bg-secondary"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(100, Math.round(progress.percent))}
      >
        <span
          className={cn("block h-full rounded-full", barColors[progress.status])}
          style={{ width: `${Math.min(100, Math.max(0, Math.round(progress.percent)))}%` }}
        />
      </span>
      <span className={cn("text-xs", textColors[progress.status])}>
        <GoalStatusText progress={progress} />
      </span>
      {children}
    </li>
  );
}
