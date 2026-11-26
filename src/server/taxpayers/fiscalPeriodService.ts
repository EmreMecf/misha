import { Prisma } from "@prisma/client";
import { z } from "zod";
import { AppError, notFound } from "@/server/errors";
import { audit } from "@/server/audit/auditService";
import { assertPermission, tenantScope, type RequestContext } from "@/server/tenancy/context";
import { withTenant } from "@/server/tenancy/tenantDb";
import { getAccessibleTaxpayer } from "./taxpayerService";

const isoDate = z.iso.date("Tarih YYYY-AA-GG biçiminde olmalı");

export const fiscalPeriodSchema = z
  .object({
    name: z.string().trim().min(1).max(50),
    startDate: isoDate,
    endDate: isoDate,
  })
  .refine((v) => v.startDate <= v.endDate, { message: "Bitiş tarihi başlangıçtan önce olamaz", path: ["endDate"] });

const toDate = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/** Takvim yılı dönemi (ör. 2026 → 01.01.2026 – 31.12.2026). */
export const calendarYearPeriod = (year: number) => ({ name: String(year), startDate: `${year}-01-01`, endDate: `${year}-12-31` });

export async function listFiscalPeriods(ctx: RequestContext, taxpayerId: string) {
  assertPermission(ctx, "period:read");
  return withTenant(tenantScope(ctx), async (tx) => {
    const taxpayer = await getAccessibleTaxpayer(tx, ctx, taxpayerId);
    return tx.fiscalPeriod.findMany({ where: { taxpayerId: taxpayer.id }, orderBy: { startDate: "desc" } });
  });
}

export async function createFiscalPeriod(ctx: RequestContext, taxpayerId: string, input: z.input<typeof fiscalPeriodSchema>) {
  assertPermission(ctx, "period:manage");
  const data = fiscalPeriodSchema.parse(input);
  try {
    return await withTenant(tenantScope(ctx), async (tx) => {
      const taxpayer = await getAccessibleTaxpayer(tx, ctx, taxpayerId);
      const period = await tx.fiscalPeriod.create({
        data: {
          organizationId: ctx.organizationId,
          taxpayerId: taxpayer.id,
          name: data.name,
          startDate: toDate(data.startDate),
          endDate: toDate(data.endDate),
          createdBy: ctx.userId,
        },
      });
      await audit(tx, {
        organizationId: ctx.organizationId,
        actorUserId: ctx.userId,
        action: "fiscal_period.create",
        resourceType: "fiscal_period",
        resourceId: period.id,
        taxpayerId: taxpayer.id,
        details: data,
        ipAddress: ctx.ipAddress,
      });
      return period;
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new AppError("CONFLICT", "Bu adla bir dönem zaten var");
    }
    // Çakışan dönem: exclusion constraint (23P01)
    if (error instanceof Prisma.PrismaClientUnknownRequestError || error instanceof Prisma.PrismaClientKnownRequestError) {
      if (String(error.message).includes("fiscal_periods_no_overlap")) {
        throw new AppError("CONFLICT", "Bu tarih aralığı mükellefin başka bir dönemiyle çakışıyor");
      }
    }
    throw error;
  }
}

export async function setFiscalPeriodStatus(ctx: RequestContext, taxpayerId: string, periodId: string, status: "OPEN" | "CLOSED") {
  assertPermission(ctx, "period:manage");
  return withTenant(tenantScope(ctx), async (tx) => {
    const taxpayer = await getAccessibleTaxpayer(tx, ctx, taxpayerId);
    const period = await tx.fiscalPeriod.findFirst({ where: { id: periodId, taxpayerId: taxpayer.id } });
    if (!period) throw notFound("Mali dönem");
    if (period.status === status) return period;
    const updated = await tx.fiscalPeriod.update({ where: { id: period.id }, data: { status } });
    await audit(tx, {
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: status === "CLOSED" ? "fiscal_period.close" : "fiscal_period.reopen",
      resourceType: "fiscal_period",
      resourceId: period.id,
      taxpayerId: taxpayer.id,
      ipAddress: ctx.ipAddress,
    });
    return updated;
  });
}
