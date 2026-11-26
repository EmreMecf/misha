import type { NextRequest } from "next/server";
import { apiContext, errorResponse } from "@/lib/http";
import { getDocumentFile } from "@/server/documents/documentService";

const INLINE = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp"]);

// GET /api/v1/documents/:id/file -> orijinal dosya. PDF/görsel önizleme için satır içi, diğerleri indirme.
// Dosya güvenilmeyen içeriktir: sandbox CSP, nosniff; XML/HTML hiçbir zaman tarayıcıda çalıştırılmaz.
export async function GET(request: NextRequest, ctx: RouteContext<"/api/v1/documents/[id]/file">) {
  try {
    const context = await apiContext(request);
    const file = await getDocumentFile(context, (await ctx.params).id);
    const inline = INLINE.has(file.mimeType);
    const asciiName = file.name.normalize("NFKD").replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "");
    return new Response(new Uint8Array(file.data), {
      headers: {
        "Content-Type": inline ? file.mimeType : "application/octet-stream",
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(file.name)}`,
        // Chrome PDF görüntüleyicisi sandbox içinde çalışmaz; PDF'te sandbox yok ama betik/bağlantı yine kapalı
        "Content-Security-Policy":
          file.mimeType === "application/pdf"
            ? "default-src 'none'; object-src 'self'; frame-ancestors 'self'"
            : "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'self'",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
