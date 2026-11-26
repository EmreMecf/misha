import { Prisma } from "@prisma/client";
import { AppError } from "@/server/errors";
import { audit } from "@/server/audit/auditService";
import { enqueue } from "@/server/jobs/jobQueue";
import { storeFile } from "@/server/storage/fileStorage";
import { assertPermission, tenantScope, type RequestContext } from "@/server/tenancy/context";
import { withTenant, type Tx } from "@/server/tenancy/tenantDb";
import { getAccessibleTaxpayer } from "@/server/taxpayers/taxpayerService";
import { expandZip, FileRejected, LIMITS, sha256Hex, sniffFile } from "./fileSecurity";
import { recordCreated, transition } from "./stateMachine";

export const PROCESS_JOB = "document.process";

export interface UploadInput {
  name: string;
  data: Uint8Array;
}

export interface UploadResultItem {
  fileName: string;
  outcome: "QUEUED" | "DUPLICATE" | "REJECTED";
  documentId: string | null;
  duplicateOfId?: string | null;
  message?: string;
}

const isUniqueViolation = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

/** Aynı mükellefte aynı içerikli "asıl" belge (mükerrer veya reddedilmiş olmayan). */
async function findOriginal(tx: Tx, taxpayerId: string, sha256: string) {
  return tx.document.findFirst({ where: { taxpayerId, sha256, status: { notIn: ["DUPLICATE", "REJECTED"] } }, select: { id: true } });
}

/**
 * Belgeleri güvenlik kontrolünden geçirip saklar ve işleme kuyruğuna alır. ZIP açılır ve her dosya
 * ayrı belge olur. Aynı içerik daha önce yüklendiyse dosya tekrar saklanmaz, DUPLICATE kaydı açılır.
 * Kontrolü geçemeyen dosya saklanmaz; sonuç listesinde nedeniyle döner.
 */
export async function uploadDocuments(ctx: RequestContext, taxpayerId: string, files: UploadInput[]): Promise<UploadResultItem[]> {
  assertPermission(ctx, "document:upload");
  if (files.length === 0) throw new AppError("VALIDATION_ERROR", "En az bir dosya seçin");
  if (files.length > LIMITS.maxFilesPerUpload) throw new AppError("VALIDATION_ERROR", `Tek seferde en fazla ${LIMITS.maxFilesPerUpload} dosya yükleyin; çok sayıda belge için ZIP kullanın`);

  // Mükellef erişimini işlemden önce doğrula (başka ofis/atanmamış ise bulunamadı)
  await withTenant(tenantScope(ctx), (tx) => getAccessibleTaxpayer(tx, ctx, taxpayerId));

  const results: UploadResultItem[] = [];
  for (const file of files) {
    let sniffed;
    try {
      sniffed = sniffFile(file.name, file.data);
    } catch (error) {
      results.push({ fileName: file.name, outcome: "REJECTED", documentId: null, message: error instanceof FileRejected ? error.message : "Dosya okunamadı" });
      continue;
    }
    if (sniffed.format !== "ZIP") {
      results.push(await storeOne(ctx, taxpayerId, file, null));
      continue;
    }
    let entries: UploadInput[];
    try {
      entries = expandZip(file.data);
    } catch (error) {
      results.push({ fileName: file.name, outcome: "REJECTED", documentId: null, message: error instanceof FileRejected ? error.message : "ZIP açılamadı" });
      continue;
    }
    for (const entry of entries) results.push(await storeOne(ctx, taxpayerId, { name: `${file.name} › ${entry.name}`, data: entry.data }, entry.name));
  }

  await withTenant(tenantScope(ctx), (tx) =>
    audit(tx, {
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "document.upload",
      resourceType: "document",
      taxpayerId,
      details: {
        queued: results.filter((r) => r.outcome === "QUEUED").length,
        duplicate: results.filter((r) => r.outcome === "DUPLICATE").length,
        rejected: results.filter((r) => r.outcome === "REJECTED").length,
      },
      ipAddress: ctx.ipAddress,
    }),
  );
  return results;
}

async function storeOne(ctx: RequestContext, taxpayerId: string, file: UploadInput, sniffName: string | null): Promise<UploadResultItem> {
  let sniffed;
  try {
    sniffed = sniffFile(sniffName ?? file.name, file.data);
    if (sniffed.format === "ZIP") throw new FileRejected("İç içe ZIP desteklenmiyor");
  } catch (error) {
    return { fileName: file.name, outcome: "REJECTED", documentId: null, message: error instanceof FileRejected ? error.message : "Dosya okunamadı" };
  }
  const sha256 = sha256Hex(file.data);
  const actor = { userId: ctx.userId };
  const base = {
    organizationId: ctx.organizationId,
    taxpayerId,
    originalName: file.name.slice(0, 255),
    mimeType: sniffed.mimeType,
    format: sniffed.format,
    sizeBytes: file.data.byteLength,
    sha256,
    uploadedBy: ctx.userId,
  };

  const original = await withTenant(tenantScope(ctx), (tx) => findOriginal(tx, taxpayerId, sha256));
  if (original) return recordDuplicate(ctx, base, original.id, file.name);

  const storageKey = await storeFile(ctx.organizationId, file.data, sniffed.extension);
  try {
    return await withTenant(tenantScope(ctx), async (tx) => {
      const created = await tx.document.create({ data: { ...base, storageKey, status: "UPLOADED" } });
      await recordCreated(tx, created, actor, "Yüklendi");
      let doc = await transition(tx, created, "VALIDATING", { actor, reason: "Dosya imzası ve boyut kontrolü" });
      doc = await transition(tx, doc, "QUEUED", { actor, reason: `${sniffed.format} olarak doğrulandı` });
      await enqueue(tx, {
        organizationId: ctx.organizationId,
        type: PROCESS_JOB,
        idempotencyKey: `${PROCESS_JOB}:${doc.id}:${doc.version}`,
        payload: { documentId: doc.id },
      });
      return { fileName: file.name, outcome: "QUEUED" as const, documentId: doc.id };
    });
  } catch (error) {
    // Eşzamanlı aynı içerik yüklemesi: kısmi benzersiz indeks yakaladı → mükerrer
    if (isUniqueViolation(error)) {
      const winner = await withTenant(tenantScope(ctx), (tx) => findOriginal(tx, taxpayerId, sha256));
      if (winner) return recordDuplicate(ctx, base, winner.id, file.name);
    }
    throw error;
  }
}

async function recordDuplicate(
  ctx: RequestContext,
  base: Prisma.DocumentUncheckedCreateInput,
  originalId: string,
  fileName: string,
): Promise<UploadResultItem> {
  const doc = await withTenant(tenantScope(ctx), async (tx) => {
    const created = await tx.document.create({
      data: { ...base, status: "DUPLICATE", duplicateOfId: originalId, statusReason: "Aynı dosya bu mükellefe daha önce yüklenmiş" },
    });
    await recordCreated(tx, created, { userId: ctx.userId }, "Aynı içerik (SHA-256) zaten kayıtlı");
    return created;
  });
  return { fileName, outcome: "DUPLICATE", documentId: doc.id, duplicateOfId: originalId, message: "Bu dosya daha önce yüklenmiş" };
}
