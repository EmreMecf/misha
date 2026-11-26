import { NextResponse, type NextRequest } from "next/server";
import { apiContext, errorResponse, readJson } from "@/lib/http";
import { createFiscalPeriod, listFiscalPeriods } from "@/server/taxpayers/fiscalPeriodService";

// GET /api/v1/taxpayers/:id/fiscal-periods
export async function GET(request: NextRequest, ctx: RouteContext<"/api/v1/taxpayers/[id]/fiscal-periods">) {
  try {
    const context = await apiContext(request);
    return NextResponse.json({ items: await listFiscalPeriods(context, (await ctx.params).id) });
  } catch (error) {
    return errorResponse(error);
  }
}

// POST /api/v1/taxpayers/:id/fiscal-periods { name, startDate, endDate } -> çakışan dönem reddedilir
export async function POST(request: NextRequest, ctx: RouteContext<"/api/v1/taxpayers/[id]/fiscal-periods">) {
  try {
    const context = await apiContext(request);
    const body = (await readJson(request)) as Parameters<typeof createFiscalPeriod>[2];
    return NextResponse.json(await createFiscalPeriod(context, (await ctx.params).id, body), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
