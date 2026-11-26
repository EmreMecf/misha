import { NextResponse, type NextRequest } from "next/server";
import { apiContext, errorResponse, readJson } from "@/lib/http";
import { setRoleMapping } from "@/server/ledger/chartService";

// PUT /api/v1/taxpayers/:id/ledger/roles { role, accountId|null } -> rol → hesap eşlemesi
export async function PUT(request: NextRequest, ctx: RouteContext<"/api/v1/taxpayers/[id]/ledger/roles">) {
  try {
    const context = await apiContext(request);
    const body = (await readJson(request)) as Parameters<typeof setRoleMapping>[2];
    return NextResponse.json(await setRoleMapping(context, (await ctx.params).id, body));
  } catch (error) {
    return errorResponse(error);
  }
}
