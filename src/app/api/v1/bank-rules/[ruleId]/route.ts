import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { apiContext, errorResponse, readJson } from "@/lib/http";
import { setBankRuleActive } from "@/server/bank/bankService";

const bodySchema = z.object({ isActive: z.boolean() });

// PATCH /api/v1/bank-rules/:ruleId { isActive }
export async function PATCH(request: NextRequest, ctx: RouteContext<"/api/v1/bank-rules/[ruleId]">) {
  try {
    const context = await apiContext(request);
    const { isActive } = bodySchema.parse(await readJson(request));
    return NextResponse.json(await setBankRuleActive(context, (await ctx.params).ruleId, isActive));
  } catch (error) {
    return errorResponse(error);
  }
}
