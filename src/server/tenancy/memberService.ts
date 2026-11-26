import { randomBytes } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { AppError, notFound } from "@/server/errors";
import { audit } from "@/server/audit/auditService";
import { hashPassword } from "@/server/auth/password";
import { revokeAllSessions } from "@/server/auth/session";
import { assertPermission, tenantScope, type RequestContext } from "./context";
import { withTenant } from "./tenantDb";

const roleSchema = z.enum(["OFFICE_OWNER", "ACCOUNTANT", "STAFF", "AUDITOR", "TAXPAYER_USER", "READ_ONLY"]);

export const addMemberSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email("Geçerli bir e-posta girin").max(320)),
  fullName: z.string().trim().min(2).max(200),
  role: roleSchema,
});

export const updateMemberSchema = z.object({
  role: roleSchema.optional(),
  status: z.enum(["ACTIVE", "ARCHIVED"]).optional(),
});

/** Okunabilir geçici parola (karışan karakterler yok). Bir kez gösterilir, ilk girişte değiştirilmesi istenir. */
function temporaryPassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = randomBytes(14);
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join("");
}

export async function listMembers(ctx: RequestContext) {
  assertPermission(ctx, "member:read");
  return withTenant(tenantScope(ctx), (tx) =>
    tx.membership.findMany({
      where: { organizationId: ctx.organizationId },
      include: { user: { select: { email: true, fullName: true, status: true } }, _count: { select: { assignments: true } } },
      orderBy: { createdAt: "asc" },
    }),
  );
}

/**
 * Ofise personel ekler. E-posta sistemde yoksa kullanıcı geçici parolayla oluşturulur (yanıtta bir kez döner);
 * varsa mevcut kullanıcı bu ofise de üye yapılır (parolası değişmez).
 */
export async function addMember(ctx: RequestContext, input: z.input<typeof addMemberSchema>) {
  assertPermission(ctx, "member:manage");
  const data = addMemberSchema.parse(input);
  let temporary: string | null = null;

  let user = await prisma.user.findUnique({ where: { email: data.email } });
  if (!user) {
    temporary = temporaryPassword();
    user = await prisma.user.create({
      data: { email: data.email, fullName: data.fullName, passwordHash: await hashPassword(temporary), mustChangePassword: true },
    });
  }
  const userId = user.id;

  const membership = await withTenant(tenantScope(ctx), async (tx) => {
    const existing = await tx.membership.findFirst({ where: { organizationId: ctx.organizationId, userId } });
    if (existing) throw new AppError("CONFLICT", "Bu kişi zaten ofisin üyesi");
    const created = await tx.membership.create({
      data: { organizationId: ctx.organizationId, userId, role: data.role, createdBy: ctx.userId },
    });
    await audit(tx, {
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "member.add",
      resourceType: "membership",
      resourceId: created.id,
      details: { role: data.role, newUser: temporary !== null },
      ipAddress: ctx.ipAddress,
    });
    return created;
  });
  return { membership, temporaryPassword: temporary };
}

export async function updateMember(ctx: RequestContext, membershipId: string, input: z.input<typeof updateMemberSchema>) {
  assertPermission(ctx, "member:manage");
  const data = updateMemberSchema.parse(input);
  const result = await withTenant(tenantScope(ctx), async (tx) => {
    const member = await tx.membership.findFirst({ where: { id: membershipId, organizationId: ctx.organizationId } });
    if (!member) throw notFound("Personel");
    const demotingOwner = member.role === "OFFICE_OWNER" && ((data.role && data.role !== "OFFICE_OWNER") || data.status === "ARCHIVED");
    if (demotingOwner) {
      const owners = await tx.membership.count({ where: { organizationId: ctx.organizationId, role: "OFFICE_OWNER", status: "ACTIVE" } });
      if (owners <= 1) throw new AppError("CONFLICT", "Ofisin en az bir aktif sahibi olmalı");
    }
    const updated = await tx.membership.update({ where: { id: member.id }, data });
    await audit(tx, {
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "member.update",
      resourceType: "membership",
      resourceId: member.id,
      details: { from: { role: member.role, status: member.status }, to: data },
      ipAddress: ctx.ipAddress,
    });
    return updated;
  });
  // Üyeliği pasifleştirilen kişinin bu ofisteki oturumları bir sonraki istekte zaten geçersiz;
  // başka ofisi yoksa tüm oturumlarını kapat.
  if (data.status === "ARCHIVED") {
    const remaining = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.user_id', ${result.userId}, true)`;
      return tx.membership.count({ where: { userId: result.userId, status: "ACTIVE" } });
    });
    if (remaining === 0) await revokeAllSessions(result.userId);
  }
  return result;
}
