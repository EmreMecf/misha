import { NextResponse, type NextRequest } from "next/server";
import { apiContext, errorResponse, readJson } from "@/lib/http";
import { createTaxpayer, listTaxpayers } from "@/server/taxpayers/taxpayerService";

// GET /api/v1/taxpayers?search=&includeArchived=1 -> rolün görebildiği mükellefler
export async function GET(request: NextRequest) {
  try {
    const ctx = await apiContext(request);
    const p = request.nextUrl.searchParams;
    const items = await listTaxpayers(ctx, { search: p.get("search") ?? undefined, includeArchived: p.get("includeArchived") === "1" });
    return NextResponse.json({ items });
  } catch (error) {
    return errorResponse(error);
  }
}

// POST /api/v1/taxpayers { title, taxId, taxOffice?, naceCode?, activity?, ledgerType?, address? }
export async function POST(request: NextRequest) {
  try {
    const ctx = await apiContext(request);
    const body = (await readJson(request)) as Parameters<typeof createTaxpayer>[1];
    return NextResponse.json(await createTaxpayer(ctx, body), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
