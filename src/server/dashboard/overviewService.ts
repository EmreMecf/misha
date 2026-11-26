import { can } from "@/server/tenancy/permissions";
import { tenantScope, type RequestContext } from "@/server/tenancy/context";
import { withTenant } from "@/server/tenancy/tenantDb";
import { taxpayerVisibility } from "@/server/taxpayers/taxpayerService";

/** Genel Bakış için gerçek sayılar (rolün görebildiği kapsamda); sahte istatistik yok. */
export async function getOverview(ctx: RequestContext, today = new Date()) {
  return withTenant(tenantScope(ctx), async (tx) => {
    const visible = taxpayerVisibility(ctx);
    const todayDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    const [activeTaxpayers, archivedTaxpayers, withoutCurrentPeriod, members, recent] = await Promise.all([
      tx.taxpayer.count({ where: { ...visible, status: "ACTIVE" } }),
      tx.taxpayer.count({ where: { ...visible, status: "ARCHIVED" } }),
      // Bugünü kapsayan açık mali dönemi olmayan aktif mükellefler: belge işlenemez, dikkat ister
      tx.taxpayer.findMany({
        where: {
          ...visible,
          status: "ACTIVE",
          fiscalPeriods: { none: { status: "OPEN", startDate: { lte: todayDate }, endDate: { gte: todayDate } } },
        },
        select: { id: true, title: true },
        orderBy: { title: "asc" },
        take: 8,
      }),
      can(ctx.role, "member:read") ? tx.membership.count({ where: { organizationId: ctx.organizationId, status: "ACTIVE" } }) : Promise.resolve(null),
      can(ctx.role, "audit:read")
        ? tx.auditLog.findMany({ where: { organizationId: ctx.organizationId }, orderBy: { createdAt: "desc" }, take: 6 })
        : Promise.resolve(null),
    ]);
    return { activeTaxpayers, archivedTaxpayers, withoutCurrentPeriod, members, recent };
  });
}
