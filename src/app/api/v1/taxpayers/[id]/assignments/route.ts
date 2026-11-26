import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { apiContext, errorResponse, readJson } from "@/lib/http";
import { assignMember, unassignMember } from "@/server/taxpayers/taxpayerService";

// POST /api/v1/taxpayers/:id/assignments { membershipId } -> personeli mükellefe atar
export async function POST(request: NextRequest, ctx: RouteContext<"/api/v1/taxpayers/[id]/assignments">) {
  try {
    const context = await apiContext(request);
    const body = (await readJson(request)) as Parameters<typeof assignMember>[2];
    return NextResponse.json(await assignMember(context, (await ctx.params).id, body), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

// DELETE /api/v1/taxpayers/:id/assignments?membershipId= -> atamayı kaldırır
export async function DELETE(request: NextRequest, ctx: RouteContext<"/api/v1/taxpayers/[id]/assignments">) {
  try {
    const context = await apiContext(request);
    const membershipId = z.uuid().parse(request.nextUrl.searchParams.get("membershipId"));
    await unassignMember(context, (await ctx.params).id, membershipId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
