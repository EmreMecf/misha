import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { apiContext, errorResponse, readJson } from "@/lib/http";
import { setFiscalPeriodStatus } from "@/server/taxpayers/fiscalPeriodService";

const bodySchema = z.object({ status: z.enum(["OPEN", "CLOSED"]) });

// PATCH /api/v1/taxpayers/:id/fiscal-periods/:periodId { status } -> dönemi kapatır / yeniden açar
export async function PATCH(request: NextRequest, ctx: RouteContext<"/api/v1/taxpayers/[id]/fiscal-periods/[periodId]">) {
  try {
    const context = await apiContext(request);
    const { id, periodId } = await ctx.params;
    const { status } = bodySchema.parse(await readJson(request));
    return NextResponse.json(await setFiscalPeriodStatus(context, id, periodId, status));
  } catch (error) {
    return errorResponse(error);
  }
}
