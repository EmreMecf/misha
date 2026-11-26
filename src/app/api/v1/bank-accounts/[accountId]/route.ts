import { NextResponse, type NextRequest } from "next/server";
import { apiContext, errorResponse } from "@/lib/http";
import { getBankAccountDetail } from "@/server/bank/bankService";

// GET /api/v1/bank-accounts/:accountId?status= -> ekstreler, hareketler (önerileriyle), kurallar
export async function GET(request: NextRequest, ctx: RouteContext<"/api/v1/bank-accounts/[accountId]">) {
  try {
    const context = await apiContext(request);
    const status = request.nextUrl.searchParams.get("status") ?? undefined;
    return NextResponse.json(await getBankAccountDetail(context, (await ctx.params).accountId, { status: status as never }));
  } catch (error) {
    return errorResponse(error);
  }
}
