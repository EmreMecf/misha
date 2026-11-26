import { NextResponse, type NextRequest } from "next/server";
import { apiContext, errorResponse } from "@/lib/http";
import { getDocumentJournal, proposeForDocument } from "@/server/ledger/journalService";

// GET /api/v1/documents/:id/journal -> belgenin fişleri + seçilebilir hesaplar
export async function GET(request: NextRequest, ctx: RouteContext<"/api/v1/documents/[id]/journal">) {
  try {
    const context = await apiContext(request);
    return NextResponse.json(await getDocumentJournal(context, (await ctx.params).id));
  } catch (error) {
    return errorResponse(error);
  }
}

// POST /api/v1/documents/:id/journal -> fiş önerisi oluştur / yeniden öner (taslak değişir)
export async function POST(request: NextRequest, ctx: RouteContext<"/api/v1/documents/[id]/journal">) {
  try {
    const context = await apiContext(request);
    return NextResponse.json(await proposeForDocument(context, (await ctx.params).id), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
