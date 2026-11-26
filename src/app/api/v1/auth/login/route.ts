import { NextResponse, type NextRequest } from "next/server";
import { assertSameOrigin, clientIp, errorResponse, readJson, setSessionCookie } from "@/lib/http";
import { login } from "@/server/auth/authService";

// POST /api/v1/auth/login { email, password } -> oturum çerezi (hız sınırlı)
export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const body = (await readJson(request)) as Parameters<typeof login>[0];
    const result = await login(body, { ipAddress: clientIp(request), userAgent: request.headers.get("user-agent") });
    const response = NextResponse.json({ organizationId: result.organizationId, mustChangePassword: result.mustChangePassword });
    setSessionCookie(response, result.token);
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
