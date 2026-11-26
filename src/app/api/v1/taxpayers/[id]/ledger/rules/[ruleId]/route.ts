import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { apiContext, errorResponse, readJson } from "@/lib/http";
import { setPostingRuleActive } from "@/server/ledger/chartService";

const bodySchema = z.object({ isActive: z.boolean() });

// PATCH /api/v1/taxpayers/:id/ledger/rules/:ruleId { isActive } -> kesin kuralı aç/kapat
export async function PATCH(request: NextRequest, ctx: RouteContext<"/api/v1/taxpayers/[id]/ledger/rules/[ruleId]">) {
  try {
    const context = await apiContext(request);
    const { id, ruleId } = await ctx.params;
    const { isActive } = bodySchema.parse(await readJson(request));
    return NextResponse.json(await setPostingRuleActive(context, id, ruleId, isActive));
  } catch (error) {
    return errorResponse(error);
  }
}
