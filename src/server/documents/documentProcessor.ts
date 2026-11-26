import Decimal from "decimal.js";
import type { Job, Prisma } from "@prisma/client";
import { z } from "zod";
import { readStoredFile } from "@/server/storage/fileStorage";
import { WORKER_ID, type JobHandler } from "@/server/jobs/jobQueue";
import { withTenant, type Tx } from "@/server/tenancy/tenantDb";
import { transition } from "./stateMachine";
import { resolveDirection, validateInvoice, type ValidationResult } from "./ubl/invoiceValidation";
import { looksLikeUblInvoice, parseUblInvoice, UblParseError, UBL_PARSER, type ParsedUblInvoice } from "./ubl/ublParser";

const actor = { worker: `document-processor@${WORKER_ID}` };
const payloadSchema = z.object({ documentId: z.uuid() });

type Doc = Prisma.DocumentGetPayload<{ include: { taxpayer: { select: { taxId: true } } } }>;

/** Okuma henüz desteklenmeyen biçimler: belge saklanır, açık nedenle elle işleme bekler. */
const PENDING_SUPPORT: Partial<Record<Doc["format"], string>> = {
  PDF: "PDF metin çıkarımı ve OCR henüz etkin değil; belge saklandı, alanları elle girilmeli",
  IMAGE: "Görsel OCR sağlayıcısı yapılandırılmadı; belge saklandı, alanları elle girilmeli",
  SPREADSHEET: "Excel belge okuma henüz etkin değil; belge saklandı",
  CSV: "CSV belge okuma henüz etkin değil; belge saklandı",
};

const dec = (d: Decimal) => d.toFixed(2);

/**
 * Kuyruktaki belgeyi işler: sınıflandırma → ayrıştırma → doğrulama → mükellef ve dönem eşleştirme.
 * Aynı iş tekrar çalışsa (yeniden deneme) bile yalnızca QUEUED durumundaki belge işlenir; yan etki tekrarlanmaz.
 */
export async function processDocument(organizationId: string, documentId: string): Promise<void> {
  await withTenant({ organizationId }, async (tx) => {
    const found = await tx.document.findFirst({ where: { id: documentId }, include: { taxpayer: { select: { taxId: true } } } });
    if (!found || found.status !== "QUEUED") return; // idempotent: zaten işlenmiş / başka durumda
    let doc: Doc = found;

    doc = { ...doc, ...(await transition(tx, doc, "CLASSIFYING", { actor, reason: `Biçim: ${doc.format}` })) };

    if (doc.format !== "XML") {
      await transition(tx, doc, "VALIDATION_REQUIRED", { actor, reason: PENDING_SUPPORT[doc.format] ?? "Bu biçim için okuyucu yok" });
      return;
    }

    const data = await readStoredFile(doc.storageKey!);
    const xml = new TextDecoder("utf-8").decode(data);
    if (!looksLikeUblInvoice(xml)) {
      await transition(tx, doc, "VALIDATION_REQUIRED", { actor, reason: "XML bir UBL-TR fatura değil (ör. irsaliye veya başka belge); elle incelenmeli" });
      return;
    }

    doc = { ...doc, ...(await transition(tx, doc, "EXTRACTING", { actor, reason: "UBL-TR fatura ayrıştırılıyor" })) };
    let parsed: ReturnType<typeof parseUblInvoice>;
    try {
      parsed = parseUblInvoice(xml);
    } catch (error) {
      if (error instanceof UblParseError) {
        await transition(tx, doc, "VALIDATION_REQUIRED", { actor, reason: error.message });
        return;
      }
      throw error;
    }
    const { invoice } = parsed;
    const documentType = invoice.profileId === "EARSIVFATURA" ? "E_ARCHIVE_INVOICE" : "E_INVOICE";
    const direction = resolveDirection(invoice, doc.taxpayer.taxId);
    const counterparty = direction === "SALE" ? invoice.customer : invoice.supplier;
    const header = {
      documentType,
      ettn: invoice.ettn,
      documentNo: invoice.invoiceNo,
      documentDate: new Date(`${invoice.issueDate}T00:00:00.000Z`),
      counterpartyTaxId: counterparty.taxId,
      counterpartyName: counterparty.name?.slice(0, 255) ?? null,
      payableAmount: dec(invoice.totals.payable),
      currency: invoice.currency.slice(0, 3),
    } as const;

    if (!direction) {
      await transition(tx, doc, "REJECTED", {
        actor,
        reason: `Fatura bu mükellefe ait değil (satıcı ${invoice.supplier.taxId ?? "?"}, alıcı ${invoice.customer.taxId ?? "?"})`,
        data: { documentType, ettn: null, documentNo: invoice.invoiceNo },
      });
      return;
    }

    // Aynı ETTN mükellefte zaten kayıtlıysa (farklı dosya içeriğiyle bile) mükerrer
    const sameEttn = await tx.document.findFirst({
      where: { taxpayerId: doc.taxpayerId, ettn: invoice.ettn, id: { not: doc.id }, status: { notIn: ["DUPLICATE", "REJECTED"] } },
      select: { id: true },
    });
    if (sameEttn) {
      await transition(tx, doc, "DUPLICATE", {
        actor,
        reason: `Aynı ETTN'li fatura (${invoice.invoiceNo}) zaten kayıtlı`,
        data: { ...header, ettn: null, duplicateOfId: sameEttn.id, direction },
      });
      return;
    }

    const validation = validateInvoice(invoice);
    const period = await tx.fiscalPeriod.findFirst({
      where: { taxpayerId: doc.taxpayerId, status: "OPEN", startDate: { lte: header.documentDate }, endDate: { gte: header.documentDate } },
      select: { id: true },
    });
    if (!period) {
      validation.errors.push({ code: "NO_OPEN_PERIOD", message: `${invoice.issueDate} tarihini kapsayan açık mali dönem yok`, field: "issueDate" });
    }

    await saveExtraction(tx, doc, invoice, parsed.fields, validation, direction);
    const next = validation.errors.length > 0 ? "VALIDATION_REQUIRED" : "NEEDS_REVIEW";
    await transition(tx, doc, next, {
      actor,
      reason: validation.errors.length > 0 ? validation.errors.map((e) => e.message).join("; ") : validation.warnings.length > 0 ? `${validation.warnings.length} uyarı` : "Alanlar okundu",
      data: { ...header, direction, fiscalPeriodId: period?.id ?? null },
    });
  });
}

async function saveExtraction(
  tx: Tx,
  doc: Doc,
  invoice: ParsedUblInvoice,
  fields: Record<string, unknown>,
  validation: ValidationResult,
  direction: "PURCHASE" | "SALE",
) {
  await tx.documentExtraction.updateMany({ where: { documentId: doc.id, isCurrent: true }, data: { isCurrent: false } });
  await tx.invoice.deleteMany({ where: { documentId: doc.id } });

  const data = JSON.parse(JSON.stringify(invoice, (_k, v) => (v instanceof Decimal ? v.toString() : v))) as Prisma.InputJsonValue;
  const extraction = await tx.documentExtraction.create({
    data: {
      organizationId: doc.organizationId,
      documentId: doc.id,
      parser: UBL_PARSER.name,
      parserVersion: UBL_PARSER.version,
      method: "XML_PARSER",
      data,
      fields: fields as Prisma.InputJsonValue,
      validation: validation as unknown as Prisma.InputJsonValue,
      // XML'den doğrudan okunan alanlar kesin; tutarlılık uyarısı güveni düşürür
      confidence: validation.errors.length > 0 ? "0.500" : validation.warnings.length > 0 ? "0.900" : "1.000",
    },
  });
  await tx.invoice.create({
    data: {
      organizationId: doc.organizationId,
      taxpayerId: doc.taxpayerId,
      documentId: doc.id,
      extractionId: extraction.id,
      direction,
      profileId: invoice.profileId.slice(0, 40),
      invoiceTypeCode: invoice.invoiceTypeCode.slice(0, 40),
      invoiceNo: invoice.invoiceNo,
      ettn: invoice.ettn,
      issueDate: new Date(`${invoice.issueDate}T00:00:00.000Z`),
      currency: invoice.currency.slice(0, 3),
      exchangeRate: invoice.exchangeRate?.toFixed(6) ?? null,
      supplierTaxId: invoice.supplier.taxId,
      supplierName: invoice.supplier.name?.slice(0, 255) ?? null,
      customerTaxId: invoice.customer.taxId,
      customerName: invoice.customer.name?.slice(0, 255) ?? null,
      lineExtensionAmount: dec(invoice.totals.lineExtension),
      allowanceTotal: dec(invoice.totals.allowanceTotal),
      taxExclusiveAmount: dec(invoice.totals.taxExclusive),
      taxInclusiveAmount: dec(invoice.totals.taxInclusive),
      withholdingTotal: dec(invoice.totals.withholdingTotal),
      payableAmount: dec(invoice.totals.payable),
      lines: {
        create: invoice.lines.map((l) => ({
          organizationId: doc.organizationId,
          lineNo: l.lineNo,
          name: l.name || "—",
          stockCode: l.stockCode?.slice(0, 100) ?? null,
          quantity: l.quantity.toDecimalPlaces(4).toFixed(4),
          unitCode: l.unitCode?.slice(0, 10) ?? null,
          unitPrice: l.unitPrice?.toDecimalPlaces(8).toFixed(8) ?? null,
          discountAmount: dec(l.discountAmount),
          lineAmount: dec(l.lineAmount),
          vatRate: l.vatRate.toFixed(2),
          vatAmount: dec(l.vatAmount),
        })),
      },
      taxes: {
        create: invoice.taxes.map((t) => ({
          organizationId: doc.organizationId,
          taxTypeCode: t.code?.slice(0, 10) ?? null,
          taxName: t.name.slice(0, 100),
          rate: t.rate?.toFixed(2) ?? null,
          taxableAmount: dec(t.taxable),
          taxAmount: dec(t.amount),
          isWithholding: t.isWithholding,
        })),
      },
    },
  });
}

/** Kuyruk işleyicisi: son denemede de hata alırsa belge FAILED olur (sessizce kaybolmaz). */
export const processDocumentJob: JobHandler = async (job: Job) => {
  const { documentId } = payloadSchema.parse(job.payload);
  try {
    await processDocument(job.organizationId, documentId);
  } catch (error) {
    if (job.attempts >= job.maxAttempts) {
      await withTenant({ organizationId: job.organizationId }, async (tx) => {
        const doc = await tx.document.findFirst({ where: { id: documentId } });
        if (doc && ["QUEUED", "CLASSIFYING", "EXTRACTING"].includes(doc.status)) {
          await transition(tx, doc, "FAILED", { actor, reason: `İşlenemedi: ${error instanceof Error ? error.message.slice(0, 300) : "bilinmeyen hata"}` });
        }
      });
    }
    throw error;
  }
};

export const JOB_HANDLERS: Record<string, JobHandler> = { "document.process": processDocumentJob };
