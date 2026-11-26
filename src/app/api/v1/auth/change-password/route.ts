import { NextResponse, type NextRequest } from "next/server";
import { apiContext, errorResponse, readJson } from "@/lib/http";
import { changePassword } from "@/server/auth/authService";

// POST /api/v1/auth/change-password { currentPassword, newPassword } -> diğer oturumlar kapanır
export async function POST(request: NextRequest) {
  try {
    const ctx = await apiContext(request);
    const body = (await readJson(request)) as Parameters<typeof changePassword>[1];
    await changePassword({ userId: ctx.userId, sessionId: ctx.sessionId, organizationId: ctx.organizationId, ipAddress: ctx.ipAddress }, body);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
