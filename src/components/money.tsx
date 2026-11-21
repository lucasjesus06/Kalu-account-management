import { formatBRL } from "@/lib/format";
import { cn } from "@/lib/utils";

export function Money({ value, className }: { value: number; className?: string }) {
  return <span className={cn("money tabular-nums", className)}>{formatBRL(value)}</span>;
}
