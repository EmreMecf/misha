import type { Role } from "@prisma/client";
import { AppError } from "@/server/errors";
import { resolveSession } from "@/server/auth/session";
import { can, type Permission } from "./permissions";
import { withTenant } from "./tenantDb";

/** Doğrulanmış istek bağlamı: kim, hangi ofiste, hangi rolle. */
export interface RequestContext {
  userId: string;
  sessionId: string;
  email: string;
  fullName: string;
  organizationId: string;
  membershipId: string;
  role: Role;
  /** Geçici parolayla girildi: parola değiştirilene kadar yalnızca parola değişimi ve çıkış yapılabilir. */
  mustChangePassword: boolean;
  ipAddress: string | null;
}

/**
 * Oturum token'ından bağlamı çözer. Üyelik her istekte veritabanından okunur: rol değişikliği veya
 * üyelik kaldırma bir sonraki istekte etkili olur.
 */
export async function resolveContext(token: string | null | undefined, ipAddress: string | null = null): Promise<RequestContext | null> {
  const session = await resolveSession(token);
  if (!session || !session.organizationId) return null;
  const organizationId = session.organizationId;
  const membership = await withTenant({ organizationId, userId: session.userId }, (tx) =>
    tx.membership.findFirst({
      where: { organizationId, userId: session.userId, status: "ACTIVE", organization: { status: "ACTIVE" } },
      select: { id: true, role: true },
    }),
  );
  if (!membership) return null;
  return {
    userId: session.userId,
    sessionId: session.id,
    email: session.user.email,
    fullName: session.user.fullName,
    organizationId,
    membershipId: membership.id,
    role: membership.role,
    mustChangePassword: session.user.mustChangePassword,
    ipAddress,
  };
}

export function assertPermission(ctx: RequestContext, permission: Permission) {
  if (!can(ctx.role, permission)) throw new AppError("FORBIDDEN", "Bu işlem için yetkiniz yok");
}

export const tenantScope = (ctx: RequestContext) => ({ organizationId: ctx.organizationId, userId: ctx.userId });
