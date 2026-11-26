import type { DocumentStatus } from "@prisma/client";
import { z } from "zod";
import { AppError, notFound } from "@/server/errors";
import { audit } from "@/server/audit/auditService";
import { enqueue } from "@/server/jobs/jobQueue";
import { readStoredFile } from "@/server/storage/fileStorage";
import { assertPermission, tenantScope, type RequestContext } from "@/server/tenancy/context";
import { withTenant, type Tx } from "@/server/tenancy/tenantDb";
import { getAccessibleTaxpayer } from "@/server/taxpayers/taxpayerService";
import { PROCESS_JOB } from "./documentUploadService";
import { getAccessibleDocument } from "./documentAccess";
import { proposeForDocumentInTx } from "@/server/ledger/journalService";
import { transition } from "./stateMachine";

const STATUSES = [
  "UPLOADED", "VALIDATING", "QUEUED", "CLASSIFYING", "EXTRACTING", "OCR_PROCESSING", "AI_PROCESSING", "VALIDATION_REQUIRED",
  "ACCOUNTING_PENDING", "NEEDS_REVIEW", "APPROVED", "EXPORT_PENDING", "EXPORTING", "EXPORTED", "FAILED", "DUPLICATE", "REJECTED", "ARCHIVED",
] as const satisfies readonly DocumentStatus[];

export const listQuerySchema = z.object({
  status: z.enum(STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.uuid().optional(),
});

export async function listDocuments(ctx: RequestContext, taxpayerId: string, input: z.input<typeof listQuerySchema> = {}) {
  assertPermission(ctx, "document:read");
  const { status, limit, cursor } = listQuerySchema.parse(input);
  return withTenant(tenantScope(ctx), async (tx) => {
    const taxpayer = await getAccessibleTaxpayer(tx, ctx, taxpayerId);
    const [rows, counts] = await Promise.all([
      tx.document.findMany({
        where: { taxpayerId: taxpayer.id, ...(status ? { status } : {}) },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: {
          id: true, originalName: true, format: true, status: true, statusReason: true, documentType: true, direction: true,
          documentNo: true, documentDate: true, counterpartyName: true, payableAmount: true, currency: true, createdAt: true, duplicateOfId: true,
        },
      }),
      tx.document.groupBy({ by: ["status"], where: { taxpayerId: taxpayer.id }, _count: { _all: true } }),
    ]);
    return {
      items: rows.slice(0, limit),
      nextCursor: rows.length > limit ? rows[limit - 1].id : null,
      counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])) as Partial<Record<DocumentStatus, number>>,
    };
  });
}

export async function getDocument(ctx: RequestContext, documentId: string) {
  assertPermission(ctx, "document:read");
  return withTenant(tenantScope(ctx), async (tx) => {
    const doc = await getAccessibleDocument(tx, ctx, documentId);
    const [extraction, invoice, events, taxpayer] = await Promise.all([
      tx.documentExtraction.findFirst({ where: { documentId: doc.id, isCurrent: true } }),
      tx.invoice.findUnique({ where: { documentId: doc.id }, include: { lines: { orderBy: { lineNo: "asc" } }, taxes: true } }),
      tx.documentStatusEvent.findMany({ where: { documentId: doc.id }, orderBy: { createdAt: "asc" } }),
      tx.taxpayer.findUniqueOrThrow({ where: { id: doc.taxpayerId }, select: { id: true, title: true } }),
    ]);
    return { ...doc, extraction, invoice, events, taxpayer };
  });
}

/** Belge dosyası (yalnızca erişimi olan kullanıcıya). */
export async function getDocumentFile(ctx: RequestContext, documentId: string) {
  assertPermission(ctx, "document:read");
  const doc = await withTenant(tenantScope(ctx), (tx) => getAccessibleDocument(tx, ctx, documentId));
  const key = doc.storageKey ?? (doc.duplicateOfId ? (await withTenant(tenantScope(ctx), (tx) => getAccessibleDocument(tx, ctx, doc.duplicateOfId!))).storageKey : null);
  if (!key) throw notFound("Belge dosyası");
  return { data: await readStoredFile(key), mimeType: doc.mimeType, name: doc.originalName };
}

export const rejectSchema = z.object({ reason: z.string().trim().min(3, "Ret nedeni yazın").max(500) });

async function act(ctx: RequestContext, documentId: string, fn: (tx: Tx, doc: Awaited<ReturnType<typeof getAccessibleDocument>>) => Promise<{ action: string; to: DocumentStatus; reason?: string }>) {
  assertPermission(ctx, "document:review");
  return withTenant(tenantScope(ctx), async (tx) => {
    const doc = await getAccessibleDocument(tx, ctx, documentId);
    const result = await fn(tx, doc);
    await audit(tx, {
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: result.action,
      resourceType: "document",
      resourceId: doc.id,
      taxpayerId: doc.taxpayerId,
      details: { from: doc.status, to: result.to, ...(result.reason ? { reason: result.reason } : {}) },
      ipAddress: ctx.ipAddress,
    });
    return { id: doc.id, status: result.to };
  });
}

/** Kontrol edildi: alanlar doğru → muhasebeleştirmeye hazır (Faz 3). */
export function markReviewed(ctx: RequestContext, documentId: string) {
  return act(ctx, documentId, async (tx, doc) => {
    if (doc.status !== "NEEDS_REVIEW") throw new AppError("CONFLICT", "Yalnızca kontrol bekleyen belge onaylanabilir");
    await transition(tx, doc, "ACCOUNTING_PENDING", { actor: { userId: ctx.userId }, reason: "Alanlar kullanıcı tarafından kontrol edildi" });
    // Hesap planı varsa fiş önerisi hemen hazırlanır (yoksa belge sayfasından sonra önerilir)
    await proposeForDocumentInTx(tx, ctx, doc.id);
    return { action: "document.review", to: "ACCOUNTING_PENDING" };
  });
}

export async function rejectDocument(ctx: RequestContext, documentId: string, input: z.input<typeof rejectSchema>) {
  const { reason } = rejectSchema.parse(input);
  return act(ctx, documentId, async (tx, doc) => {
    await transition(tx, doc, "REJECTED", { actor: { userId: ctx.userId }, reason });
    return { action: "document.reject", to: "REJECTED", reason };
  });
}

/** Yeniden işle (ör. eksik mali dönem açıldıktan sonra): kuyruğa yeni sürümle girer. */
export function reprocessDocument(ctx: RequestContext, documentId: string) {
  return act(ctx, documentId, async (tx, doc) => {
    if (!doc.storageKey) throw new AppError("CONFLICT", "Bu kaydın dosyası yok (mükerrer kayıt); asıl belgeyi işleyin");
    const queued = await transition(tx, doc, "QUEUED", { actor: { userId: ctx.userId }, reason: "Yeniden işleme istendi" });
    await enqueue(tx, { organizationId: doc.organizationId, type: PROCESS_JOB, idempotencyKey: `${PROCESS_JOB}:${doc.id}:${queued.version}`, payload: { documentId: doc.id } });
    return { action: "document.reprocess", to: "QUEUED" };
  });
}
