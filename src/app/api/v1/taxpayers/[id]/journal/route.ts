import { NextResponse, type NextRequest } from "next/server";
import { apiContext, errorResponse } from "@/lib/http";
import { listJournal } from "@/server/ledger/journalService";

// GET /api/v1/taxpayers/:id/journal?status=&fiscalPeriodId= -> yevmiye listesi
export async function GET(request: NextRequest, ctx: RouteContext<"/api/v1/taxpayers/[id]/journal">) {
  try {
    const context = await apiContext(request);
    const p = request.nextUrl.searchParams;
    return NextResponse.json(
      await listJournal(context, (await ctx.params).id, {
        status: (p.get("status") ?? undefined) as never,
        fiscalPeriodId: p.get("fiscalPeriodId") ?? undefined,
      }),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
