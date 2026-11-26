import { NextResponse, type NextRequest } from "next/server";
import { apiContext, errorResponse } from "@/lib/http";
import { AppError } from "@/server/errors";
import { importStatement, previewStatement } from "@/server/bank/bankService";
import { STATEMENT_LIMITS } from "@/server/bank/statementParser";

// POST /api/v1/bank-accounts/:accountId/statements (multipart: file, mapping? (JSON), mode = preview | import)
export async function POST(request: NextRequest, ctx: RouteContext<"/api/v1/bank-accounts/[accountId]/statements">) {
  try {
    const context = await apiContext(request);
    if (Number(request.headers.get("content-length") ?? 0) > STATEMENT_LIMITS.maxBytes + 64 * 1024) {
      throw new AppError("VALIDATION_ERROR", "Ekstre dosyası en fazla 5 MB olabilir");
    }
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw new AppError("BAD_REQUEST", "İstek multipart/form-data olmalı");
    }
    const file = form.get("file");
    if (!(file instanceof File)) throw new AppError("VALIDATION_ERROR", "Ekstre dosyası seçin");
    const rawMapping = form.get("mapping");
    let mapping: unknown;
    try {
      mapping = typeof rawMapping === "string" && rawMapping ? JSON.parse(rawMapping) : undefined;
    } catch {
      throw new AppError("BAD_REQUEST", "Sütun eşlemesi geçersiz");
    }
    const input = { name: file.name, data: new Uint8Array(await file.arrayBuffer()) };
    const accountId = (await ctx.params).accountId;
    if (form.get("mode") === "import") {
      return NextResponse.json(await importStatement(context, accountId, input, mapping), { status: 201 });
    }
    return NextResponse.json(await previewStatement(context, accountId, input, mapping));
  } catch (error) {
    return errorResponse(error);
  }
}
