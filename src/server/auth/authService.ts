import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { AppError } from "@/server/errors";
import { audit } from "@/server/audit/auditService";
import { detectTaxId } from "@/server/taxpayers/taxIds";
import { withTenant, withUserScope } from "@/server/tenancy/tenantDb";
import { burnPasswordCheck, hashPassword, passwordSchema, verifyPassword } from "./password";
import { isLoginBlocked, recordLoginAttempt } from "./rateLimit";
import { createSession, revokeAllSessions, revokeSession, setSessionOrganization, type SessionMeta } from "./session";

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email("Geçerli bir e-posta girin").max(320));

export const registerSchema = z.object({
  organizationName: z.string().trim().min(2, "Ofis adı en az 2 karakter").max(255),
  organizationTaxId: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v.replace(/\s+/g, "") : undefined))
    .refine((v) => !v || detectTaxId(v) !== null, "Geçerli bir VKN veya TCKN girin"),
  fullName: z.string().trim().min(2, "Ad soyad gerekli").max(200),
  email: emailSchema,
  password: passwordSchema,
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Parola gerekli").max(200),
});

/**
 * Yeni muhasebe ofisi ve sahibini oluşturur (tek transaction): kullanıcı, ofis, OFFICE_OWNER üyeliği,
 * denetim kaydı. Ardından ofis seçili oturum açar.
 */
export async function registerOffice(input: z.input<typeof registerSchema>, meta: SessionMeta = {}) {
  const data = registerSchema.parse(input);
  const passwordHash = await hashPassword(data.password);
  const organizationId = randomUUID();

  let userId: string;
  try {
    userId = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({ data: { email: data.email, fullName: data.fullName, passwordHash } });
      await tx.$executeRaw`SELECT set_config('app.organization_id', ${organizationId}, true)`;
      await tx.organization.create({ data: { id: organizationId, name: data.organizationName, taxId: data.organizationTaxId ?? null } });
      await tx.membership.create({ data: { organizationId, userId: user.id, role: "OFFICE_OWNER", createdBy: user.id } });
      await audit(tx, {
        organizationId,
        actorUserId: user.id,
        action: "organization.register",
        resourceType: "organization",
        resourceId: organizationId,
        ipAddress: meta.ipAddress,
      });
      return user.id;
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new AppError("CONFLICT", "Bu e-posta ile kayıtlı bir kullanıcı var; giriş yapın");
    }
    throw error;
  }

  const { token } = await createSession(userId, organizationId, meta);
  return { token, userId, organizationId };
}

const INVALID_CREDENTIALS = "E-posta veya parola hatalı";

/** Giriş: hız sınırı, sabit süreli doğrulama, aktif ofis üyeliği; başarıda oturum token'ı döner. */
export async function login(input: z.input<typeof loginSchema>, meta: SessionMeta = {}, now = new Date()) {
  const { email, password } = loginSchema.parse(input);
  const ip = meta.ipAddress ?? null;

  if (await isLoginBlocked(email, ip, now)) {
    throw new AppError("RATE_LIMITED", "Çok fazla başarısız deneme. 15 dakika sonra tekrar deneyin.");
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    await burnPasswordCheck(password);
    await recordLoginAttempt(email, ip, false, now);
    throw new AppError("UNAUTHENTICATED", INVALID_CREDENTIALS);
  }
  const valid = await verifyPassword(user.passwordHash, password);
  if (!valid || user.status !== "ACTIVE") {
    await recordLoginAttempt(email, ip, false, now);
    throw new AppError("UNAUTHENTICATED", INVALID_CREDENTIALS);
  }

  const memberships = await listUserOrganizations(user.id);
  if (memberships.length === 0 && !user.isSuperAdmin) {
    await recordLoginAttempt(email, ip, false, now);
    throw new AppError("FORBIDDEN", "Hesabınızın aktif bir ofis üyeliği yok. Ofis yöneticinizle görüşün.");
  }

  await recordLoginAttempt(email, ip, true, now);
  const organizationId = memberships[0]?.organizationId ?? null;
  const { token } = await createSession(user.id, organizationId, meta, now);
  if (organizationId) {
    await withTenant({ organizationId, userId: user.id }, (tx) =>
      audit(tx, { organizationId, actorUserId: user.id, action: "auth.login", resourceType: "session", ipAddress: ip }),
    );
  }
  return { token, userId: user.id, organizationId, mustChangePassword: user.mustChangePassword };
}

/** Kullanıcının aktif üyelikleri (yalnızca kendi satırlarını görebildiği RLS bağlamında). */
export async function listUserOrganizations(userId: string) {
  return withUserScope(userId, (tx) =>
    tx.membership.findMany({
      where: { userId, status: "ACTIVE", organization: { status: "ACTIVE" } },
      select: { organizationId: true, role: true, organization: { select: { name: true } } },
      orderBy: { createdAt: "asc" },
    }),
  );
}

export async function logout(token: string, actor?: { userId: string; organizationId: string | null; ipAddress?: string | null }) {
  await revokeSession(token);
  if (actor?.organizationId) {
    await withTenant({ organizationId: actor.organizationId, userId: actor.userId }, (tx) =>
      audit(tx, { organizationId: actor.organizationId!, actorUserId: actor.userId, action: "auth.logout", resourceType: "session", ipAddress: actor.ipAddress }),
    );
  }
}

/** Oturumun aktif ofisini değiştirir; kullanıcı o ofisin aktif üyesi olmalı. */
export async function switchOrganization(sessionId: string, userId: string, organizationId: string) {
  const orgs = await listUserOrganizations(userId);
  if (!orgs.some((o) => o.organizationId === organizationId)) throw new AppError("FORBIDDEN", "Bu ofise erişiminiz yok");
  await setSessionOrganization(sessionId, organizationId);
}

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: passwordSchema,
});

/** Parola değişimi: mevcut parola doğrulanır, diğer tüm oturumlar kapatılır. */
export async function changePassword(
  actor: { userId: string; sessionId: string; organizationId: string | null; ipAddress?: string | null },
  input: z.input<typeof changePasswordSchema>,
) {
  const { currentPassword, newPassword } = changePasswordSchema.parse(input);
  if (currentPassword === newPassword) throw new AppError("VALIDATION_ERROR", "Yeni parola mevcut paroladan farklı olmalı");
  const user = await prisma.user.findUniqueOrThrow({ where: { id: actor.userId } });
  if (!(await verifyPassword(user.passwordHash, currentPassword))) throw new AppError("UNAUTHENTICATED", "Mevcut parola hatalı");
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(newPassword), mustChangePassword: false } });
  await revokeAllSessions(user.id, actor.sessionId);
  if (actor.organizationId) {
    await withTenant({ organizationId: actor.organizationId, userId: user.id }, (tx) =>
      audit(tx, { organizationId: actor.organizationId!, actorUserId: user.id, action: "auth.password_change", resourceType: "user", resourceId: user.id, ipAddress: actor.ipAddress }),
    );
  }
}
