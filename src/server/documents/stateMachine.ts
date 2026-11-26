import type { DocumentStatus } from "@prisma/client";
import { AppError } from "@/server/errors";
import type { Tx } from "@/server/tenancy/tenantDb";
import { STATUS_LABELS } from "@/lib/documentLabels";

export { STATUS_LABELS };

/** İzin verilen durum geçişleri. Burada olmayan geçiş reddedilir. */
export const TRANSITIONS: Readonly<Record<DocumentStatus, readonly DocumentStatus[]>> = {
  UPLOADED: ["VALIDATING", "DUPLICATE", "REJECTED", "FAILED"],
  VALIDATING: ["QUEUED", "DUPLICATE", "REJECTED", "FAILED"],
  QUEUED: ["CLASSIFYING", "FAILED"],
  CLASSIFYING: ["EXTRACTING", "OCR_PROCESSING", "VALIDATION_REQUIRED", "REJECTED", "FAILED"],
  EXTRACTING: ["NEEDS_REVIEW", "VALIDATION_REQUIRED", "DUPLICATE", "REJECTED", "FAILED"],
  OCR_PROCESSING: ["EXTRACTING", "AI_PROCESSING", "VALIDATION_REQUIRED", "FAILED"],
  AI_PROCESSING: ["NEEDS_REVIEW", "VALIDATION_REQUIRED", "FAILED"],
  VALIDATION_REQUIRED: ["NEEDS_REVIEW", "QUEUED", "REJECTED", "ARCHIVED"],
  NEEDS_REVIEW: ["ACCOUNTING_PENDING", "VALIDATION_REQUIRED", "QUEUED", "REJECTED"],
  ACCOUNTING_PENDING: ["APPROVED", "NEEDS_REVIEW", "REJECTED"],
  APPROVED: ["EXPORT_PENDING", "ACCOUNTING_PENDING"],
  EXPORT_PENDING: ["EXPORTING", "APPROVED"],
  EXPORTING: ["EXPORTED", "FAILED"],
  EXPORTED: ["APPROVED", "ARCHIVED"],
  FAILED: ["QUEUED", "REJECTED", "ARCHIVED"],
  DUPLICATE: ["ARCHIVED"],
  REJECTED: ["QUEUED", "ARCHIVED"],
  ARCHIVED: [],
};


export const canTransition = (from: DocumentStatus, to: DocumentStatus) => TRANSITIONS[from].includes(to);

export interface TransitionActor {
  userId?: string | null;
  worker?: string | null;
}

/**
 * Belgeyi `from` durumundan `to` durumuna geçirir. Geçiş tanımlı değilse veya belge bu arada başka bir
 * işlemle değiştiyse (durum ya da sürüm uyuşmuyor) hata verir; geçiş değiştirilemez geçmişe yazılır.
 */
export async function transition(
  tx: Tx,
  doc: { id: string; organizationId: string; status: DocumentStatus; version: number },
  to: DocumentStatus,
  options: { reason?: string | null; actor: TransitionActor; data?: Record<string, unknown> },
) {
  if (!canTransition(doc.status, to)) {
    throw new AppError("CONFLICT", `Belge "${STATUS_LABELS[doc.status]}" durumundan "${STATUS_LABELS[to]}" durumuna geçemez`);
  }
  const reason = options.reason?.slice(0, 500) ?? null;
  const { count } = await tx.document.updateMany({
    where: { id: doc.id, status: doc.status, version: doc.version },
    data: { ...(options.data ?? {}), status: to, statusReason: reason, version: { increment: 1 } },
  });
  if (count === 0) throw new AppError("CONFLICT", "Belge bu arada başka bir işlemle değişti; sayfayı yenileyin");
  await tx.documentStatusEvent.create({
    data: {
      organizationId: doc.organizationId,
      documentId: doc.id,
      fromStatus: doc.status,
      toStatus: to,
      reason,
      actorUserId: options.actor.userId ?? null,
      actorWorker: options.actor.worker ?? null,
    },
  });
  return { ...doc, status: to, version: doc.version + 1 };
}

/** İlk kayıt olayı (belge oluşturulurken). */
export async function recordCreated(tx: Tx, doc: { id: string; organizationId: string; status: DocumentStatus }, actor: TransitionActor, reason?: string) {
  await tx.documentStatusEvent.create({
    data: {
      organizationId: doc.organizationId,
      documentId: doc.id,
      fromStatus: null,
      toStatus: doc.status,
      reason: reason ?? null,
      actorUserId: actor.userId ?? null,
      actorWorker: actor.worker ?? null,
    },
  });
}
