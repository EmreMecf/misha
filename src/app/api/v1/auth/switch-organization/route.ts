import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { apiContext, errorResponse, readJson } from "@/lib/http";
import { switchOrganization } from "@/server/auth/authService";

const bodySchema = z.object({ organizationId: z.uuid() });

// POST /api/v1/auth/switch-organization { organizationId } -> oturumun aktif ofisini değiştirir
export async function POST(request: NextRequest) {
  try {
    const ctx = await apiContext(request);
    const { organizationId } = bodySchema.parse(await readJson(request));
    await switchOrganization(ctx.sessionId, ctx.userId, organizationId);
    return NextResponse.json({ organizationId });
  } catch (error) {
    return errorResponse(error);
  }
}
