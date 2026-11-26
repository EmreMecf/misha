// Gerçek PostgreSQL gerektirir: npm run db:up && npm run db:deploy && npm run test:integration
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { zipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { makeVkn, uniqueEmail, uniqueVkn } from "@/test/fixtures";
import { encode, ublInvoiceXml } from "@/test/ublFixture";
import { login, registerOffice } from "@/server/auth/authService";
import { enqueue, runPendingJobs, type JobHandler } from "@/server/jobs/jobQueue";
import { resolveContext, type RequestContext } from "@/server/tenancy/context";
import { addMember } from "@/server/tenancy/memberService";
import { withTenant } from "@/server/tenancy/tenantDb";
import { createFiscalPeriod } from "@/server/taxpayers/fiscalPeriodService";
import { createTaxpayer } from "@/server/taxpayers/taxpayerService";
import { JOB_HANDLERS, processDocument } from "./documentProcessor";
import { getDocument, getDocumentFile, listDocuments, markReviewed, rejectDocument, reprocessDocument } from "./documentService";
import { uploadDocuments } from "./documentUploadService";

process.env.STORAGE_DIR = mkdtempSync(path.join(tmpdir(), "mihsap-test-storage-"));

const PASSWORD = "test-parolasi-123";
const orgs: string[] = [];
const users: string[] = [];
let ctx: RequestContext;
let other: RequestContext;
let taxpayerId: string;
let taxpayerVkn: string;
const SUPPLIER = makeVkn("444444445");

async function office(label: string) {
  const r = await registerOffice({ organizationName: `${label} Ofis`, fullName: `${label} Sahibi`, email: uniqueEmail(label), password: PASSWORD });
  orgs.push(r.organizationId);
  users.push(r.userId);
  return (await resolveContext(r.token))!;
}

const runJobs = () => runPendingJobs(JOB_HANDLERS, 100, "test-worker");
const status = async (id: string) => (await getDocument(ctx, id)).status;
const xmlFile = (name: string, opts: Partial<Parameters<typeof ublInvoiceXml>[0]> = {}) => ({
  name,
  data: encode(ublInvoiceXml({ supplierTaxId: SUPPLIER, customerTaxId: taxpayerVkn, ...opts })),
});

beforeAll(async () => {
  ctx = await office("belgeA");
  other = await office("belgeB");
  taxpayerVkn = uniqueVkn();
  taxpayerId = (await createTaxpayer(ctx, { title: "Belge Test A.Ş.", taxId: taxpayerVkn })).id;
  await createFiscalPeriod(ctx, taxpayerId, { name: "2026", startDate: "2026-01-01", endDate: "2026-12-31" });
});

afterAll(async () => {
  for (const id of orgs) await withTenant({ organizationId: id }, (tx) => tx.organization.deleteMany({ where: { id } }));
  // jobs tablosu uygulama rolüne silme izni vermez (kuyruk geçmişi korunur); test işleri SUCCEEDED/DEAD kalır
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
});

describe("belge yükleme ve işleme hattı (PostgreSQL)", () => {
  let invoiceDocId: string;

  it("e-Fatura XML'i yüklenir, kuyrukta işlenir, alanlar ve kalemler kaydedilir, kontrol bekler", async () => {
    const [result] = await uploadDocuments(ctx, taxpayerId, [
      xmlFile("fatura.xml", { invoiceNo: "TST2026000000101", lines: [{ name: "Un", amount: "900.00", vatRate: "1", vatAmount: "9.00", stockCode: "UN50", quantity: "10" }] }),
    ]);
    expect(result.outcome).toBe("QUEUED");
    invoiceDocId = result.documentId!;
    expect(await status(invoiceDocId)).toBe("QUEUED");

    expect(await runJobs()).toBeGreaterThanOrEqual(1);
    const doc = await getDocument(ctx, invoiceDocId);
    expect(doc).toMatchObject({ status: "NEEDS_REVIEW", documentType: "E_INVOICE", direction: "PURCHASE", documentNo: "TST2026000000101", counterpartyTaxId: SUPPLIER });
    expect(doc.fiscalPeriodId).not.toBeNull();
    expect(doc.invoice?.lines.map((l) => [l.stockCode, l.lineAmount.toFixed(2), l.vatRate.toFixed(2)])).toEqual([["UN50", "900.00", "1.00"]]);
    expect(doc.invoice?.payableAmount.toFixed(2)).toBe("909.00");
    expect(doc.extraction).toMatchObject({ parser: "ubl-tr", method: "XML_PARSER", isCurrent: true });
    expect(doc.events.map((e) => e.toStatus)).toEqual(["UPLOADED", "VALIDATING", "QUEUED", "CLASSIFYING", "EXTRACTING", "NEEDS_REVIEW"]);
    expect(doc.events.at(-1)?.actorWorker).toMatch(/^document-processor@/);
  });

  it("aynı dosya tekrar yüklenince saklanmaz, mükerrer kaydı açılır; farklı dosyada aynı ETTN de mükerrer olur", async () => {
    const original = await getDocument(ctx, invoiceDocId);
    const sameBytes = await getDocumentFile(ctx, invoiceDocId);
    const [dup] = await uploadDocuments(ctx, taxpayerId, [{ name: "tekrar.xml", data: new Uint8Array(sameBytes.data) }]);
    expect(dup).toMatchObject({ outcome: "DUPLICATE", duplicateOfId: invoiceDocId });

    const [sameEttn] = await uploadDocuments(ctx, taxpayerId, [xmlFile("farkli-icerik.xml", { ettn: original.ettn!, invoiceNo: "TST2026000000101", lines: [{ name: "Un (düzeltilmiş açıklama)", amount: "900.00", vatRate: "1", vatAmount: "9.00" }] })]);
    expect(sameEttn.outcome).toBe("QUEUED");
    await runJobs();
    const d = await getDocument(ctx, sameEttn.documentId!);
    expect(d).toMatchObject({ status: "DUPLICATE", duplicateOfId: invoiceDocId });
    expect(d.invoice).toBeNull();
  });

  it("mükellefe ait olmayan fatura reddedilir; PDF saklanır ve elle işleme bekler (OCR yok)", async () => {
    const results = await uploadDocuments(ctx, taxpayerId, [
      { name: "baskasinin.xml", data: encode(ublInvoiceXml({ supplierTaxId: SUPPLIER, customerTaxId: makeVkn("555555556") })) },
      { name: "fis.pdf", data: encode("%PDF-1.4\n%test\n") },
      { name: "virus.exe", data: new Uint8Array([0x4d, 0x5a, 0x90, 0]) },
    ]);
    expect(results.map((r) => r.outcome)).toEqual(["QUEUED", "QUEUED", "REJECTED"]);
    await runJobs();
    const foreign = await getDocument(ctx, results[0].documentId!);
    expect(foreign.status).toBe("REJECTED");
    expect(foreign.statusReason).toMatch(/bu mükellefe ait değil/);
    const pdf = await getDocument(ctx, results[1].documentId!);
    expect(pdf.status).toBe("VALIDATION_REQUIRED");
    expect(pdf.statusReason).toMatch(/OCR henüz etkin değil/);
  });

  it("ZIP içindeki faturalar ayrı belgeler olur", async () => {
    const zip = zipSync({
      "eylul/1.xml": encode(ublInvoiceXml({ supplierTaxId: SUPPLIER, customerTaxId: taxpayerVkn, invoiceNo: "ZIP2026000000001" })),
      "eylul/2.xml": encode(ublInvoiceXml({ supplierTaxId: SUPPLIER, customerTaxId: taxpayerVkn, invoiceNo: "ZIP2026000000002" })),
    });
    const results = await uploadDocuments(ctx, taxpayerId, [{ name: "eylul.zip", data: zip }]);
    expect(results.map((r) => [r.fileName, r.outcome])).toEqual([["eylul.zip › 1.xml", "QUEUED"], ["eylul.zip › 2.xml", "QUEUED"]]);
    await runJobs();
    for (const r of results) expect(await status(r.documentId!)).toBe("NEEDS_REVIEW");
  });

  it("açık dönem yoksa düzeltme gerekir; dönem açılıp yeniden işlenince kontrole düşer", async () => {
    const [r] = await uploadDocuments(ctx, taxpayerId, [xmlFile("2027.xml", { issueDate: "2027-02-01", invoiceNo: "TST2027000000001" })]);
    await runJobs();
    const before = await getDocument(ctx, r.documentId!);
    expect(before.status).toBe("VALIDATION_REQUIRED");
    expect(before.statusReason).toMatch(/açık mali dönem yok/);

    await createFiscalPeriod(ctx, taxpayerId, { name: "2027", startDate: "2027-01-01", endDate: "2027-12-31" });
    await reprocessDocument(ctx, r.documentId!);
    await runJobs();
    const after = await getDocument(ctx, r.documentId!);
    expect(after.status).toBe("NEEDS_REVIEW");
    // Yeniden işleme önceki çıkarımı güncel olmaktan çıkarır, tek güncel çıkarım kalır
    expect(await withTenant({ organizationId: ctx.organizationId }, (tx) => tx.documentExtraction.count({ where: { documentId: r.documentId!, isCurrent: true } }))).toBe(1);
  });

  it("kontrol: onaylanan belge muhasebeleşmeyi bekler; geçersiz geçiş ve ret nedeni zorunlu", async () => {
    await expect(rejectDocument(ctx, invoiceDocId, { reason: "" })).rejects.toThrow();
    await markReviewed(ctx, invoiceDocId);
    expect(await status(invoiceDocId)).toBe("ACCOUNTING_PENDING");
    await expect(markReviewed(ctx, invoiceDocId)).rejects.toThrow(/Yalnızca kontrol bekleyen/);
  });

  it("aynı işlem iki kez çalışsa yan etki tekrarlanmaz (idempotency)", async () => {
    await processDocument(ctx.organizationId, invoiceDocId); // durum QUEUED değil: hiçbir şey yapmaz
    const invoices = await withTenant({ organizationId: ctx.organizationId }, (tx) => tx.invoice.count({ where: { documentId: invoiceDocId } }));
    expect(invoices).toBe(1);
    const first = await enqueue(prisma, { organizationId: ctx.organizationId, type: "test.noop", idempotencyKey: `test.noop:${invoiceDocId}`, payload: {} });
    const second = await enqueue(prisma, { organizationId: ctx.organizationId, type: "test.noop", idempotencyKey: `test.noop:${invoiceDocId}`, payload: {} });
    expect(first).not.toBeNull();
    expect(second).toBeNull();
    await prisma.job.update({ where: { id: first!.id }, data: { status: "SUCCEEDED" } });
  });

  it("hata alan iş yeniden denenir, hakkı bitince DEAD olur", async () => {
    const job = await enqueue(prisma, { organizationId: ctx.organizationId, type: "test.fail", idempotencyKey: `test.fail:${Date.now()}`, payload: {}, maxAttempts: 2 });
    const failing: Record<string, JobHandler> = { "test.fail": async () => { throw new Error("geçici hata"); } };
    await runPendingJobs(failing, 100, "test-worker");
    let row = await prisma.job.findUniqueOrThrow({ where: { id: job!.id } });
    expect(row).toMatchObject({ status: "PENDING", attempts: 1, lastError: "geçici hata" });
    await prisma.job.update({ where: { id: job!.id }, data: { runAfter: new Date(Date.now() - 1000) } });
    await runPendingJobs(failing, 100, "test-worker");
    row = await prisma.job.findUniqueOrThrow({ where: { id: job!.id } });
    expect(row).toMatchObject({ status: "DEAD", attempts: 2 });
  });
});

describe("belge erişim izolasyonu (PostgreSQL)", () => {
  it("başka ofis belgeyi, dosyasını ve listesini göremez; atanmamış personel de göremez", async () => {
    const [r] = await uploadDocuments(ctx, taxpayerId, [xmlFile("gizli.xml", { invoiceNo: "GZL2026000000001" })]);
    await expect(getDocument(other, r.documentId!)).rejects.toThrow("Belge bulunamadı");
    await expect(getDocumentFile(other, r.documentId!)).rejects.toThrow("bulunamadı");
    await expect(listDocuments(other, taxpayerId)).rejects.toThrow("Mükellef bulunamadı");
    await expect(uploadDocuments(other, taxpayerId, [xmlFile("x.xml")])).rejects.toThrow("Mükellef bulunamadı");

    const email = uniqueEmail("personel");
    const { membership, temporaryPassword } = await addMember(ctx, { email, fullName: "Atanmamış Personel", role: "STAFF" });
    users.push(membership.userId);
    const staff = (await resolveContext((await login({ email, password: temporaryPassword! })).token))!;
    await expect(getDocument(staff, r.documentId!)).rejects.toThrow("Belge bulunamadı");

    const raw = await withTenant({ organizationId: other.organizationId }, (tx) => tx.document.findMany({ where: { id: r.documentId! } }));
    expect(raw).toEqual([]);
  });

  it("durum geçmişi uygulama rolüyle değiştirilemez", async () => {
    await expect(withTenant({ organizationId: ctx.organizationId }, (tx) => tx.documentStatusEvent.deleteMany({}))).rejects.toThrow();
    await expect(withTenant({ organizationId: ctx.organizationId }, (tx) => tx.document.deleteMany({}))).rejects.toThrow();
  });
});
