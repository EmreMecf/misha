import { NextResponse, type NextRequest } from "next/server";
import { apiContext, errorResponse, readJson } from "@/lib/http";
import { createAccount } from "@/server/ledger/chartService";

// POST /api/v1/taxpayers/:id/ledger/accounts { code, name } -> alt hesap aç
export async function POST(request: NextRequest, ctx: RouteContext<"/api/v1/taxpayers/[id]/ledger/accounts">) {
  try {
    const context = await apiContext(request);
    const body = (await readJson(request)) as Parameters<typeof createAccount>[2];
    return NextResponse.json(await createAccount(context, (await ctx.params).id, body), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
