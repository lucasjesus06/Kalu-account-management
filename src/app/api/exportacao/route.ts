import type { NextRequest } from "next/server";
import { toCsv } from "@/domain/export";
import { fullMonth, isMonth } from "@/domain/periods";
import { getCurrentMember } from "@/server/auth";
import { loadConsumptionRecords } from "@/server/consumption";

export async function GET(request: NextRequest) {
  const member = await getCurrentMember();
  if (!member) {
    return Response.json({ error: "Sua conta ainda não está vinculada a uma residência." }, { status: 403 });
  }

  const month = request.nextUrl.searchParams.get("mes") ?? undefined;
  const format = request.nextUrl.searchParams.get("formato") === "excel" ? "excel" : "csv";
  const { records, billTotals } = await loadConsumptionRecords(member.householdId, isMonth(month) ? fullMonth(month) : undefined);
  const csv = toCsv([...records].reverse(), billTotals, format);
  const name = `kalu-transacoes-${isMonth(month) ? month : "historico"}${format === "excel" ? "-excel" : ""}.csv`;

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}
