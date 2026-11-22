import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import type { AuthorizationAlert } from "@/domain/authorization";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

const tones = {
  warning: "border-warning/30 bg-warning/10 text-warning",
  danger: "border-destructive/30 bg-destructive/10 text-destructive",
  expired: "border-destructive/30 bg-destructive/10 text-destructive",
} as const;

function message(institution: string, alert: AuthorizationAlert) {
  if (alert.level === "expired") {
    return `${institution}: a autorização expirou e a sincronização está parada.`;
  }
  const when = alert.daysLeft === 1 ? "amanhã" : `em ${alert.daysLeft} dias`;
  return `${institution}: a autorização vence ${when}, em ${formatDate(alert.expiresAt)}.`;
}

export function AuthorizationNotice({
  institution,
  alert,
  showAction = true,
}: {
  institution: string;
  alert: AuthorizationAlert;
  showAction?: boolean;
}) {
  return (
    <div role="status" className={cn("flex items-start gap-3 rounded-xl border px-4 py-3 text-sm", tones[alert.level])}>
      <TriangleAlert className="mt-0.5 size-4 shrink-0" />
      <p>
        {message(institution, alert)}
        {showAction && (
          <>
            {" "}
            <Link href="/conexoes" className="font-semibold underline underline-offset-4">
              Renovar
            </Link>
          </>
        )}
      </p>
    </div>
  );
}
