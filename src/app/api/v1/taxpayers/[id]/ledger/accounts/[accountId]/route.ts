import { NextResponse, type NextRequest } from "next/server";
import { apiContext, errorResponse, readJson } from "@/lib/http";
import { updateAccount } from "@/server/ledger/chartService";

// PATCH /api/v1/taxpayers/:id/ledger/accounts/:accountId { name?, isActive?, isPostable? }
export async function PATCH(request: NextRequest, ctx: RouteContext<"/api/v1/taxpayers/[id]/ledger/accounts/[accountId]">) {
  try {
    const context = await apiContext(request);
    const { id, accountId } = await ctx.params;
    const body = (await readJson(request)) as Parameters<typeof updateAccount>[3];
    return NextResponse.json(await updateAccount(context, id, accountId, body));
  } catch (error) {
    return errorResponse(error);
  }
}
