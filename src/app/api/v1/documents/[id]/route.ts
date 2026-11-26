import { NextResponse, type NextRequest } from "next/server";
import { apiContext, errorResponse } from "@/lib/http";
import { getDocument } from "@/server/documents/documentService";

// GET /api/v1/documents/:id -> belge, güncel çıkarım (alan kaynağı/güveni), fatura, durum geçmişi
export async function GET(request: NextRequest, ctx: RouteContext<"/api/v1/documents/[id]">) {
  try {
    const context = await apiContext(request);
    return NextResponse.json(await getDocument(context, (await ctx.params).id));
  } catch (error) {
    return errorResponse(error);
  }
}
