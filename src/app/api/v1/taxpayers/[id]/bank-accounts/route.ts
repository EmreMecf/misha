import { NextResponse, type NextRequest } from "next/server";
import { apiContext, errorResponse, readJson } from "@/lib/http";
import { createBankAccount, listBankAccounts } from "@/server/bank/bankService";

// GET /api/v1/taxpayers/:id/bank-accounts
export async function GET(request: NextRequest, ctx: RouteContext<"/api/v1/taxpayers/[id]/bank-accounts">) {
  try {
    const context = await apiContext(request);
    return NextResponse.json(await listBankAccounts(context, (await ctx.params).id));
  } catch (error) {
    return errorResponse(error);
  }
}

// POST /api/v1/taxpayers/:id/bank-accounts { name, bankName?, iban?, ledgerAccountId }
export async function POST(request: NextRequest, ctx: RouteContext<"/api/v1/taxpayers/[id]/bank-accounts">) {
  try {
    const context = await apiContext(request);
    const body = (await readJson(request)) as Parameters<typeof createBankAccount>[2];
    return NextResponse.json(await createBankAccount(context, (await ctx.params).id, body), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
