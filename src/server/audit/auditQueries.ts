import { z } from "zod";
import { assertPermission, tenantScope, type RequestContext } from "@/server/tenancy/context";
import { withTenant } from "@/server/tenancy/tenantDb";

export const auditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.uuid().optional(),
  taxpayerId: z.uuid().optional(),
});

/** Ofisin denetim kaydı, en yeni önce; imleçli sayfalama. */
export async function listAuditLogs(ctx: RequestContext, input: z.input<typeof auditQuerySchema> = {}) {
  assertPermission(ctx, "audit:read");
  const { limit, cursor, taxpayerId } = auditQuerySchema.parse(input);
  return withTenant(tenantScope(ctx), async (tx) => {
    const rows = await tx.auditLog.findMany({
      where: { organizationId: ctx.organizationId, ...(taxpayerId ? { taxpayerId } : {}) },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const actorIds = [...new Set(rows.map((r) => r.actorUserId).filter((v): v is string => !!v))];
    const actors = await tx.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, fullName: true } });
    const names = new Map(actors.map((a) => [a.id, a.fullName]));
    const page = rows.slice(0, limit).map((r) => ({ ...r, actorName: r.actorUserId ? (names.get(r.actorUserId) ?? null) : null }));
    return { items: page, nextCursor: rows.length > limit ? page[page.length - 1].id : null };
  });
}
