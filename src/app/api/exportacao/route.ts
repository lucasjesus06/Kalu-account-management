import type { NextRequest } from "next/server";
import { toCsv } from "@/domain/export";
import { fullMonth, isMonth } from "@/domain/periods";
import { getCurrentContext, listHouseholdMembers } from "@/server/auth";
import { loadConsumptionRecords } from "@/server/consumption";

export async function GET(request: NextRequest) {
  const { scope, household } = await getCurrentContext();

  const month = request.nextUrl.searchParams.get("mes") ?? undefined;
  const format = request.nextUrl.searchParams.get("formato") === "excel" ? "excel" : "csv";
  const [{ records, billTotals }, members] = await Promise.all([
    loadConsumptionRecords(scope, isMonth(month) ? fullMonth(month) : undefined),
    household ? listHouseholdMembers(household.householdId) : [],
  ]);
  const csv = toCsv(
    [...records].reverse(),
    billTotals,
    format,
    members.map((m) => m.displayName),
  );
  const name = `kalu-transacoes-${isMonth(month) ? month : "historico"}${format === "excel" ? "-excel" : ""}.csv`;

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}
