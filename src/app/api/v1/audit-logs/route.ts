import { NextResponse, type NextRequest } from "next/server";
import { apiContext, errorResponse } from "@/lib/http";
import { listAuditLogs } from "@/server/audit/auditQueries";

// GET /api/v1/audit-logs?limit=&cursor=&taxpayerId= -> ofisin işlem geçmişi (en yeni önce)
export async function GET(request: NextRequest) {
  try {
    const ctx = await apiContext(request);
    const p = request.nextUrl.searchParams;
    return NextResponse.json(
      await listAuditLogs(ctx, {
        limit: p.get("limit") ?? undefined,
        cursor: p.get("cursor") ?? undefined,
        taxpayerId: p.get("taxpayerId") ?? undefined,
      }),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
