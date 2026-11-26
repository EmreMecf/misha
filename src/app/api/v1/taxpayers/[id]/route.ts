import { NextResponse, type NextRequest } from "next/server";
import { apiContext, errorResponse, readJson } from "@/lib/http";
import { getTaxpayer, updateTaxpayer } from "@/server/taxpayers/taxpayerService";

// GET /api/v1/taxpayers/:id -> mükellef, mali dönemleri ve atanmış personel
export async function GET(request: NextRequest, ctx: RouteContext<"/api/v1/taxpayers/[id]">) {
  try {
    const context = await apiContext(request);
    return NextResponse.json(await getTaxpayer(context, (await ctx.params).id));
  } catch (error) {
    return errorResponse(error);
  }
}

// PATCH /api/v1/taxpayers/:id { ...alanlar, version } -> iyimser kilitli güncelleme
export async function PATCH(request: NextRequest, ctx: RouteContext<"/api/v1/taxpayers/[id]">) {
  try {
    const context = await apiContext(request);
    const body = (await readJson(request)) as Parameters<typeof updateTaxpayer>[2];
    return NextResponse.json(await updateTaxpayer(context, (await ctx.params).id, body));
  } catch (error) {
    return errorResponse(error);
  }
}
