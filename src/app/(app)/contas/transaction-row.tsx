import { Money } from "@/components/money";
import type { BillLine } from "@/domain/bill-details";
import { fromCents } from "@/domain/money";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CorrectCategoryButton } from "./category-correction";

const sourceLabels = {
  rule: "regra da residência",
  user: "ajustada por vocês",
} as const;

type Line = Omit<BillLine, "billExternalId">;

export function TransactionRow({
  line,
  variant,
  fallbackLabel = "Sem categoria",
}: {
  line: Line;
  variant: "bill" | "statement";
  fallbackLabel?: string;
}) {
  const isInflow = line.direction === "inflow";
  const signedCents =
    variant === "bill" ? (isInflow ? -line.amountCents : line.amountCents) : isInflow ? line.amountCents : -line.amountCents;
  return (
    <li className="flex items-center justify-between gap-4 py-2.5 text-sm">
      <div className="flex min-w-0 flex-col">
        <span className="truncate">{line.merchantName ?? line.description}</span>
        <span className="text-xs text-muted-foreground">
          {formatDate(line.occurredAt)}
          {variant === "statement" && ` · ${line.category?.name ?? fallbackLabel}`}
          {line.installmentNumber !== null &&
            line.installmentTotal !== null &&
            line.installmentTotal > 1 &&
            ` · parcela ${line.installmentNumber}/${line.installmentTotal}`}
          {line.status === "pending" && " · pendente"}
          {(line.categorySource === "rule" || line.categorySource === "user") && ` · ${sourceLabels[line.categorySource]}`}
          {" · "}
          <CorrectCategoryButton
            transactionId={line.id}
            merchant={line.merchantName ?? line.description}
            categorySlug={line.category?.slug ?? null}
          />
        </span>
      </div>
      <Money
        value={fromCents(signedCents)}
        className={cn("shrink-0", isInflow && "text-success", variant === "statement" && isInflow && "before:content-['+']")}
      />
    </li>
  );
}
