import { NextResponse, type NextRequest } from "next/server";
import { isAuthorizedCronRequest } from "@/server/cron";
import { syncAllConnections } from "@/server/sync";

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  if (!isAuthorizedCronRequest(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }
  const summary = await syncAllConnections();
  return NextResponse.json(summary);
}
