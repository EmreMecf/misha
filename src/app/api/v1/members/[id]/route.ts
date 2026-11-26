import { NextResponse, type NextRequest } from "next/server";
import { apiContext, errorResponse, readJson } from "@/lib/http";
import { updateMember } from "@/server/tenancy/memberService";

// PATCH /api/v1/members/:id { role?, status? } -> rol değiştir / pasifleştir (son sahip korunur)
export async function PATCH(request: NextRequest, ctx: RouteContext<"/api/v1/members/[id]">) {
  try {
    const context = await apiContext(request);
    const body = (await readJson(request)) as Parameters<typeof updateMember>[2];
    return NextResponse.json(await updateMember(context, (await ctx.params).id, body));
  } catch (error) {
    return errorResponse(error);
  }
}
