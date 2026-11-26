import { NextResponse, type NextRequest } from "next/server";
import { assertSameOrigin, clearSessionCookie, clientIp, errorResponse } from "@/lib/http";
import { logout } from "@/server/auth/authService";
import { SESSION_COOKIE } from "@/server/auth/session";
import { resolveContext } from "@/server/tenancy/context";

// POST /api/v1/auth/logout -> oturumu iptal eder, çerezi siler
export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const token = request.cookies.get(SESSION_COOKIE)?.value;
    if (token) {
      const ctx = await resolveContext(token);
      await logout(token, ctx ? { userId: ctx.userId, organizationId: ctx.organizationId, ipAddress: clientIp(request) } : undefined);
    }
    const response = NextResponse.json({ ok: true });
    clearSessionCookie(response);
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
