import { NextResponse, type NextRequest } from "next/server";
import { assertSameOrigin, clientIp, errorResponse, readJson, setSessionCookie } from "@/lib/http";
import { registerOffice } from "@/server/auth/authService";

// POST /api/v1/auth/register { organizationName, organizationTaxId?, fullName, email, password }
// -> yeni muhasebe ofisi + sahip kullanıcı, oturum açılır
export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const body = (await readJson(request)) as Parameters<typeof registerOffice>[0];
    const result = await registerOffice(body, { ipAddress: clientIp(request), userAgent: request.headers.get("user-agent") });
    const response = NextResponse.json({ organizationId: result.organizationId }, { status: 201 });
    setSessionCookie(response, result.token);
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
