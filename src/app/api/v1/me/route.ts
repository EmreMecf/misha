import { NextResponse, type NextRequest } from "next/server";
import { apiContext, errorResponse } from "@/lib/http";
import { listUserOrganizations } from "@/server/auth/authService";
import { ROLE_PERMISSIONS } from "@/server/tenancy/permissions";

// GET /api/v1/me -> oturum sahibi, aktif ofis, rol, izinler ve üye olunan ofisler
export async function GET(request: NextRequest) {
  try {
    const ctx = await apiContext(request);
    const organizations = await listUserOrganizations(ctx.userId);
    return NextResponse.json({
      user: { id: ctx.userId, email: ctx.email, fullName: ctx.fullName },
      organizationId: ctx.organizationId,
      role: ctx.role,
      permissions: [...ROLE_PERMISSIONS[ctx.role]],
      organizations: organizations.map((o) => ({ id: o.organizationId, name: o.organization.name, role: o.role })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
