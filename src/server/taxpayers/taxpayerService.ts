import { Prisma } from "@prisma/client";
import { z } from "zod";
import { AppError, notFound } from "@/server/errors";
import { audit, maskTaxId } from "@/server/audit/auditService";
import { assertPermission, tenantScope, type RequestContext } from "@/server/tenancy/context";
import { SEES_ALL_TAXPAYERS } from "@/server/tenancy/permissions";
import { withTenant, type Tx } from "@/server/tenancy/tenantDb";
import { detectTaxId } from "./taxIds";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : null));

export const taxpayerInputSchema = z.object({
  title: z.string().trim().min(2, "Unvan en az 2 karakter").max(255),
  taxId: z
    .string()
    .trim()
    .transform((v) => v.replace(/\s+/g, ""))
    .refine((v) => detectTaxId(v) !== null, "Geçerli bir VKN (10 hane) veya TCKN (11 hane) girin"),
  taxOffice: optionalText(120),
  naceCode: z
    .string()
    .trim()
    .regex(/^\d{2}(\.\d{1,2}){0,2}$/, "NACE kodu ör. 69.20.01 biçiminde olmalı")
    .optional()
    .or(z.literal("").transform(() => undefined))
    .transform((v) => v ?? null),
  activity: optionalText(255),
  ledgerType: z.enum(["BILANCO", "ISLETME", "SERBEST_MESLEK"]).default("BILANCO"),
  address: optionalText(500),
});

export const taxpayerUpdateSchema = taxpayerInputSchema
  .omit({ taxId: true })
  .partial()
  .extend({ status: z.enum(["ACTIVE", "ARCHIVED"]).optional(), version: z.number().int().positive() });

/** Rolün görebileceği mükellefler: tümü veya yalnızca atananlar. */
export function taxpayerVisibility(ctx: RequestContext): Prisma.TaxpayerWhereInput {
  const base: Prisma.TaxpayerWhereInput = { organizationId: ctx.organizationId };
  return SEES_ALL_TAXPAYERS.has(ctx.role) ? base : { ...base, assignments: { some: { membershipId: ctx.membershipId } } };
}

/** Mükellef bağlamın erişimindeyse döner; değilse (başka ofis veya atanmamış) bulunamadı. */
export async function getAccessibleTaxpayer(tx: Tx, ctx: RequestContext, taxpayerId: string) {
  const parsed = z.uuid().safeParse(taxpayerId);
  if (!parsed.success) throw notFound("Mükellef");
  const taxpayer = await tx.taxpayer.findFirst({ where: { id: parsed.data, ...taxpayerVisibility(ctx) } });
  if (!taxpayer) throw notFound("Mükellef");
  return taxpayer;
}

export async function listTaxpayers(ctx: RequestContext, options: { includeArchived?: boolean; search?: string } = {}) {
  assertPermission(ctx, "taxpayer:read");
  const search = options.search?.trim();
  return withTenant(tenantScope(ctx), (tx) =>
    tx.taxpayer.findMany({
      where: {
        ...taxpayerVisibility(ctx),
        ...(options.includeArchived ? {} : { status: "ACTIVE" }),
        ...(search ? { OR: [{ title: { contains: search, mode: "insensitive" } }, { taxId: { startsWith: search } }] } : {}),
      },
      orderBy: { title: "asc" },
      include: { _count: { select: { fiscalPeriods: true } } },
    }),
  );
}

export async function getTaxpayer(ctx: RequestContext, taxpayerId: string) {
  assertPermission(ctx, "taxpayer:read");
  return withTenant(tenantScope(ctx), async (tx) => {
    const taxpayer = await getAccessibleTaxpayer(tx, ctx, taxpayerId);
    const [periods, assignments] = await Promise.all([
      tx.fiscalPeriod.findMany({ where: { taxpayerId: taxpayer.id }, orderBy: { startDate: "desc" } }),
      tx.taxpayerAssignment.findMany({
        where: { taxpayerId: taxpayer.id },
        include: { membership: { select: { id: true, role: true, user: { select: { fullName: true, email: true } } } } },
      }),
    ]);
    return { ...taxpayer, fiscalPeriods: periods, assignments };
  });
}

export async function createTaxpayer(ctx: RequestContext, input: z.input<typeof taxpayerInputSchema>) {
  assertPermission(ctx, "taxpayer:create");
  const data = taxpayerInputSchema.parse(input);
  const taxId = detectTaxId(data.taxId)!;
  try {
    return await withTenant(tenantScope(ctx), async (tx) => {
      const taxpayer = await tx.taxpayer.create({
        data: { ...data, taxId: taxId.value, taxIdType: taxId.type, organizationId: ctx.organizationId, createdBy: ctx.userId },
      });
      await audit(tx, {
        organizationId: ctx.organizationId,
        actorUserId: ctx.userId,
        action: "taxpayer.create",
        resourceType: "taxpayer",
        resourceId: taxpayer.id,
        taxpayerId: taxpayer.id,
        details: { title: taxpayer.title, taxId: maskTaxId(taxpayer.taxId) },
        ipAddress: ctx.ipAddress,
      });
      return taxpayer;
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new AppError("CONFLICT", "Bu VKN/TCKN ile kayıtlı bir mükellef zaten var");
    }
    throw error;
  }
}

/** İyimser kilit: istemcinin gördüğü sürüm güncel değilse çakışma döner (eşzamanlı düzenleme kaybolmaz). */
export async function updateTaxpayer(ctx: RequestContext, taxpayerId: string, input: z.input<typeof taxpayerUpdateSchema>) {
  assertPermission(ctx, "taxpayer:update");
  const { version, ...data } = taxpayerUpdateSchema.parse(input);
  return withTenant(tenantScope(ctx), async (tx) => {
    const current = await getAccessibleTaxpayer(tx, ctx, taxpayerId);
    const { count } = await tx.taxpayer.updateMany({
      where: { id: current.id, version },
      data: { ...data, version: { increment: 1 } },
    });
    if (count === 0) throw new AppError("CONFLICT", "Kayıt siz düzenlerken başkası tarafından değiştirildi; sayfayı yenileyin");
    const changed = Object.keys(data).filter((k) => (data as Record<string, unknown>)[k] !== (current as Record<string, unknown>)[k]);
    await audit(tx, {
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "taxpayer.update",
      resourceType: "taxpayer",
      resourceId: current.id,
      taxpayerId: current.id,
      details: { changed },
      ipAddress: ctx.ipAddress,
    });
    return tx.taxpayer.findUniqueOrThrow({ where: { id: current.id } });
  });
}

export const assignmentSchema = z.object({ membershipId: z.uuid() });

/** Personeli mükellefe atar (atanmamış personel o mükellefi göremez). */
export async function assignMember(ctx: RequestContext, taxpayerId: string, input: z.input<typeof assignmentSchema>) {
  assertPermission(ctx, "taxpayer:assign");
  const { membershipId } = assignmentSchema.parse(input);
  return withTenant(tenantScope(ctx), async (tx) => {
    const taxpayer = await getAccessibleTaxpayer(tx, ctx, taxpayerId);
    const membership = await tx.membership.findFirst({ where: { id: membershipId, organizationId: ctx.organizationId, status: "ACTIVE" } });
    if (!membership) throw notFound("Personel");
    const assignment = await tx.taxpayerAssignment.upsert({
      where: { taxpayerId_membershipId: { taxpayerId: taxpayer.id, membershipId } },
      create: { organizationId: ctx.organizationId, taxpayerId: taxpayer.id, membershipId, createdBy: ctx.userId },
      update: {},
    });
    await audit(tx, {
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "taxpayer.assign",
      resourceType: "taxpayer_assignment",
      resourceId: assignment.id,
      taxpayerId: taxpayer.id,
      details: { membershipId },
      ipAddress: ctx.ipAddress,
    });
    return assignment;
  });
}

export async function unassignMember(ctx: RequestContext, taxpayerId: string, membershipId: string) {
  assertPermission(ctx, "taxpayer:assign");
  return withTenant(tenantScope(ctx), async (tx) => {
    const taxpayer = await getAccessibleTaxpayer(tx, ctx, taxpayerId);
    const { count } = await tx.taxpayerAssignment.deleteMany({ where: { taxpayerId: taxpayer.id, membershipId } });
    if (count === 0) throw notFound("Atama");
    await audit(tx, {
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "taxpayer.unassign",
      resourceType: "taxpayer_assignment",
      taxpayerId: taxpayer.id,
      details: { membershipId },
      ipAddress: ctx.ipAddress,
    });
  });
}
