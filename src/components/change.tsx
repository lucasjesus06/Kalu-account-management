import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { percentChange } from "@/domain/consumption";
import { formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

export function Change({
  current,
  previous,
  lowerIsBetter = true,
  neutral = false,
  className,
}: {
  current: number;
  previous: number;
  lowerIsBetter?: boolean;
  neutral?: boolean;
  className?: string;
}) {
  if (current === previous) {
    return <span className={cn("text-muted-foreground", className)}>igual</span>;
  }
  const percent = percentChange(current, previous);
  if (percent === null) {
    return <span className={cn("text-muted-foreground", className)}>novo</span>;
  }
  const up = current > previous;
  const good = up !== lowerIsBetter;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 font-medium",
        neutral ? "text-muted-foreground" : good ? "text-success" : "text-warning",
        className,
      )}
    >
      <Icon className="size-3.5" />
      {formatPercent(Math.abs(percent))}
    </span>
  );
}
