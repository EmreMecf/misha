import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { notFound } from "@/server/errors";
import type { RequestContext } from "@/server/tenancy/context";
import type { Tx } from "@/server/tenancy/tenantDb";
import { taxpayerVisibility } from "@/server/taxpayers/taxpayerService";

/** Belgenin erişilebilir olduğu (mükellefi görünür) kapsam. */
export const documentScope = (ctx: RequestContext): Prisma.DocumentWhereInput => ({ organizationId: ctx.organizationId, taxpayer: taxpayerVisibility(ctx) });

/** Belge bağlamın erişimindeyse döner; değilse bulunamadı (başka ofis / atanmamış mükellef). */
export async function getAccessibleDocument(tx: Tx, ctx: RequestContext, documentId: string) {
  const parsed = z.uuid().safeParse(documentId);
  if (!parsed.success) throw notFound("Belge");
  const doc = await tx.document.findFirst({ where: { id: parsed.data, ...documentScope(ctx) } });
  if (!doc) throw notFound("Belge");
  return doc;
}
