import { after, NextResponse, type NextRequest } from "next/server";
import { apiContext, errorResponse } from "@/lib/http";
import { AppError } from "@/server/errors";
import { JOB_HANDLERS } from "@/server/documents/documentProcessor";
import { listDocuments } from "@/server/documents/documentService";
import { uploadDocuments } from "@/server/documents/documentUploadService";
import { LIMITS } from "@/server/documents/fileSecurity";
import { runPendingJobs } from "@/server/jobs/jobQueue";

export const maxDuration = 120;

// GET /api/v1/taxpayers/:id/documents?status=&cursor=&limit=
export async function GET(request: NextRequest, ctx: RouteContext<"/api/v1/taxpayers/[id]/documents">) {
  try {
    const context = await apiContext(request);
    const p = request.nextUrl.searchParams;
    return NextResponse.json(
      await listDocuments(context, (await ctx.params).id, {
        status: (p.get("status") ?? undefined) as never,
        cursor: p.get("cursor") ?? undefined,
        limit: p.get("limit") ?? undefined,
      }),
    );
  } catch (error) {
    return errorResponse(error);
  }
}

// POST /api/v1/taxpayers/:id/documents (multipart, alan adı "files") -> güvenlik kontrolü, saklama, kuyruk
export async function POST(request: NextRequest, ctx: RouteContext<"/api/v1/taxpayers/[id]/documents">) {
  try {
    const context = await apiContext(request);
    const declared = Number(request.headers.get("content-length") ?? 0);
    if (declared > LIMITS.maxFileBytes * 4) throw new AppError("VALIDATION_ERROR", "Yükleme çok büyük; dosyaları parça parça veya ZIP olarak gönderin");
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw new AppError("BAD_REQUEST", "İstek multipart/form-data olmalı");
    }
    const files = await Promise.all(
      form
        .getAll("files")
        .filter((f): f is File => f instanceof File)
        .map(async (f) => ({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) })),
    );
    const results = await uploadDocuments(context, (await ctx.params).id, files);
    // Geliştirme/tek sunucu: işleri yanıt gönderildikten sonra bu süreçte çalıştır.
    // Ayrı worker kullanılan kurulumda INLINE_JOBS=false yapın (npm run worker).
    if (process.env.INLINE_JOBS !== "false") after(() => runPendingJobs(JOB_HANDLERS, 50).catch((e) => console.error("İş kuyruğu:", e)));
    return NextResponse.json({ results }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
