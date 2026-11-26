import { NextResponse, type NextRequest } from "next/server";
import { apiContext, errorResponse } from "@/lib/http";
import { getChart, initChartFromTemplate } from "@/server/ledger/chartService";

// GET /api/v1/taxpayers/:id/ledger -> hesap planı + rol eşlemeleri
export async function GET(request: NextRequest, ctx: RouteContext<"/api/v1/taxpayers/[id]/ledger">) {
  try {
    const context = await apiContext(request);
    return NextResponse.json(await getChart(context, (await ctx.params).id));
  } catch (error) {
    return errorResponse(error);
  }
}

// POST /api/v1/taxpayers/:id/ledger -> boş hesap planını TDHP şablonuyla başlat
export async function POST(request: NextRequest, ctx: RouteContext<"/api/v1/taxpayers/[id]/ledger">) {
  try {
    const context = await apiContext(request);
    return NextResponse.json(await initChartFromTemplate(context, (await ctx.params).id), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
