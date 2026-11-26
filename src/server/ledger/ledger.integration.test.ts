// Gerçek PostgreSQL gerektirir: npm run db:up && npm run db:deploy && npm run test:integration
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { makeVkn, uniqueEmail, uniqueVkn } from "@/test/fixtures";
import { encode, ublInvoiceXml } from "@/test/ublFixture";
import { login, registerOffice } from "@/server/auth/authService";
import { JOB_HANDLERS } from "@/server/documents/documentProcessor";
import { getDocument, markReviewed } from "@/server/documents/documentService";
import { uploadDocuments } from "@/server/documents/documentUploadService";
import { runPendingJobs } from "@/server/jobs/jobQueue";
import { resolveContext, type RequestContext } from "@/server/tenancy/context";
import { addMember } from "@/server/tenancy/memberService";
import { withTenant } from "@/server/tenancy/tenantDb";
import { createFiscalPeriod, setFiscalPeriodStatus } from "@/server/taxpayers/fiscalPeriodService";
import { assignMember, createTaxpayer } from "@/server/taxpayers/taxpayerService";
import { createAccount, getChart, initChartFromTemplate, listPostingRules } from "./chartService";
import { getDocumentJournal, listJournal, postEntry, proposeForDocument, reverseEntry, updateDraft } from "./journalService";

process.env.STORAGE_DIR = mkdtempSync(path.join(tmpdir(), "mihsap-ledger-storage-"));

const PASSWORD = "test-parolasi-123";
const orgs: string[] = [];
const users: string[] = [];
let ctx: RequestContext;
let other: RequestContext;
let taxpayerId: string;
let taxpayerVkn: string;
let periodId: string;
const SUPPLIER = makeVkn("777777778");

async function office(label: string) {
  const r = await registerOffice({ organizationName: `${label} Ofis`, fullName: `${label} Sahibi`, email: uniqueEmail(label), password: PASSWORD });
  orgs.push(r.organizationId);
  users.push(r.userId);
  return (await resolveContext(r.token))!;
}

async function member(role: "STAFF", assign: boolean) {
  const email = uniqueEmail(role.toLowerCase());
  const { membership, temporaryPassword } = await addMember(ctx, { email, fullName: "Test Personel", role });
  users.push(membership.userId);
  if (assign) await assignMember(ctx, taxpayerId, { membershipId: membership.id });
  return (await resolveContext((await login({ email, password: temporaryPassword! })).token))!;
}

/** Faturayı yükler, işler ve "kontrol edildi" yapar; belge kimliğini döner */
async function reviewedInvoice(invoiceNo: string, opts: Partial<Parameters<typeof ublInvoiceXml>[0]> = {}) {
  const xml = ublInvoiceXml({ supplierTaxId: SUPPLIER, customerTaxId: taxpayerVkn, invoiceNo, ...opts });
  const [r] = await uploadDocuments(ctx, taxpayerId, [{ name: `${invoiceNo}.xml`, data: encode(xml) }]);
  await runPendingJobs(JOB_HANDLERS, 50, "test-worker");
  await markReviewed(ctx, r.documentId!);
  return r.documentId!;
}

const activeEntry = async (c: RequestContext, documentId: string) => {
  const j = await getDocumentJournal(c, documentId);
  return j.entries.find((e) => !e.reversalOfId && e.status !== "REVERSED");
};

beforeAll(async () => {
  ctx = await office("defterA");
  other = await office("defterB");
  taxpayerVkn = uniqueVkn();
  taxpayerId = (await createTaxpayer(ctx, { title: "Defter Test Ltd.", taxId: taxpayerVkn })).id;
  periodId = (await createFiscalPeriod(ctx, taxpayerId, { name: "2026", startDate: "2026-01-01", endDate: "2026-12-31" })).id;
});

afterAll(async () => {
  for (const id of orgs) await withTenant({ organizationId: id }, (tx) => tx.organization.deleteMany({ where: { id } }));
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
});

describe("muhasebe motoru (PostgreSQL)", () => {
  let firstDoc: string;
  let firstEntryId: string;
  let account770: string;

  it("hesap planı yokken kontrol edilen belgede öneri oluşmaz; plan TDHP şablonuyla bir kez başlatılır", async () => {
    firstDoc = await reviewedInvoice("DFT2026000000001", { lines: [{ name: "Ofis kirası", amount: "1000.00", vatRate: "20", vatAmount: "200.00" }] });
    expect((await getDocument(ctx, firstDoc)).status).toBe("ACCOUNTING_PENDING");
    expect((await getDocumentJournal(ctx, firstDoc)).hasChart).toBe(false);
    await expect(proposeForDocument(ctx, firstDoc)).rejects.toThrow(/hesap planı yok/);

    const { accounts } = await initChartFromTemplate(ctx, taxpayerId);
    expect(accounts).toBeGreaterThan(200);
    await expect(initChartFromTemplate(ctx, taxpayerId)).rejects.toThrow(/zaten var/);
    const chart = await getChart(ctx, taxpayerId);
    expect(chart.mappings.map((m) => m.role).sort()).toEqual(["CUSTOMER", "INPUT_VAT", "OUTPUT_VAT", "SALES_RETURN", "SALES_REVENUE", "SUPPLIER", "VAT_WITHHOLDING"]);
    account770 = chart.accounts.find((a) => a.code === "770")!.id;
  });

  it("öneri dengeli ve gerekçeli; alış hesabı seçilmeden kesinleşmez", async () => {
    await proposeForDocument(ctx, firstDoc);
    const entry = (await activeEntry(ctx, firstDoc))!;
    firstEntryId = entry.id;
    expect(entry.status).toBe("DRAFT");
    expect(entry.lines.map((l) => [l.kind, l.account?.code ?? null, l.debit.toFixed(2), l.credit.toFixed(2), l.source])).toEqual([
      ["MAIN", null, "1000.00", "0.00", "UNRESOLVED"],
      ["VAT", "191", "200.00", "0.00", "ROLE_MAPPING"],
      ["COUNTERPARTY", "320", "0.00", "1200.00", "ROLE_MAPPING"],
    ]);
    await expect(postEntry(ctx, entry.id, { version: entry.version })).rejects.toThrow(/hesabı seçilmedi/);
  });

  it("kullanıcı hesabı seçip kural olarak kaydederek kesinleştirir: yevmiye no, belge onaylı, öğrenme kaydı", async () => {
    let entry = (await activeEntry(ctx, firstDoc))!;
    const main = entry.lines.find((l) => l.kind === "MAIN")!;
    await updateDraft(ctx, entry.id, { version: entry.version, lines: [{ id: main.id, accountId: account770 }] });
    entry = (await activeEntry(ctx, firstDoc))!;
    const result = await postEntry(ctx, entry.id, { version: entry.version, saveRule: true });
    expect(result).toMatchObject({ entryNo: 1, ruleCreated: true });

    const posted = (await activeEntry(ctx, firstDoc))!;
    expect(posted).toMatchObject({ status: "POSTED", entryNo: 1 });
    expect(posted.totalDebit.toFixed(2)).toBe("1200.00");
    expect((await getDocument(ctx, firstDoc)).status).toBe("APPROVED");
    const rules = await listPostingRules(ctx, taxpayerId);
    expect(rules.map((r) => [r.counterpartyTaxId, r.direction, r.account.code])).toEqual([[SUPPLIER, "PURCHASE", "770"]]);
    const corrections = await withTenant({ organizationId: ctx.organizationId }, (tx) => tx.accountCorrection.findMany({ where: { entryId: entry.id } }));
    expect(corrections).toHaveLength(1);
    expect(corrections[0]).toMatchObject({ lineKind: "MAIN", proposedAccountId: null, chosenAccountId: account770, ruleCreated: true });
  });

  it("aynı satıcının sonraki faturası kontrol edilince kuralla 770'e önerilir", async () => {
    const doc = await reviewedInvoice("DFT2026000000002", { lines: [{ name: "Ofis kirası (Kasım)", amount: "500.00", vatRate: "20", vatAmount: "100.00" }] });
    const entry = (await activeEntry(ctx, doc))!;
    const main = entry.lines.find((l) => l.kind === "MAIN")!;
    expect(main).toMatchObject({ source: "POSTING_RULE" });
    expect(main.account?.code).toBe("770");
    expect(main.reason).toMatch(/kayıtlı kural/);
    const posted = await postEntry(ctx, entry.id, { version: entry.version });
    expect(posted.entryNo).toBe(2);
  });

  it("veritabanı: kesin fiş ve satırları değiştirilemez/silinemez; dengesiz fiş kesinleşemez; başka mükellefin hesabı kullanılamaz", async () => {
    const t = { organizationId: ctx.organizationId };
    await expect(withTenant(t, (tx) => tx.journalEntry.update({ where: { id: firstEntryId }, data: { description: "değiştirildi" } }))).rejects.toThrow(/değiştirilemez/);
    await expect(withTenant(t, (tx) => tx.journalEntryLine.updateMany({ where: { entryId: firstEntryId }, data: { description: "x" } }))).rejects.toThrow(/değiştirilemez/);
    await expect(withTenant(t, (tx) => tx.journalEntry.delete({ where: { id: firstEntryId } }))).rejects.toThrow(/silinemez/);

    // Uygulamayı atlayıp dengesiz taslağı doğrudan kesinleştirme denemesi
    const draft = await withTenant(t, (tx) =>
      tx.journalEntry.create({
        data: {
          organizationId: ctx.organizationId,
          taxpayerId,
          fiscalPeriodId: periodId,
          entryDate: new Date("2026-10-01"),
          description: "Elle dengesiz",
          source: "MANUAL",
          lines: {
            create: [
              { organizationId: ctx.organizationId, lineNo: 1, kind: "MANUAL", accountId: account770, debit: "100.00", description: "a", source: "USER", reason: "test" },
              { organizationId: ctx.organizationId, lineNo: 2, kind: "MANUAL", accountId: account770, credit: "90.00", description: "b", source: "USER", reason: "test" },
            ],
          },
        },
      }),
    );
    await expect(withTenant(t, (tx) => tx.journalEntry.update({ where: { id: draft.id }, data: { status: "POSTED", entryNo: 999 } }))).rejects.toThrow(/dengesiz/);
    // Hem borç hem alacak dolu satır CHECK ile reddedilir
    await expect(
      withTenant(t, (tx) =>
        tx.journalEntryLine.create({ data: { organizationId: ctx.organizationId, entryId: draft.id, lineNo: 3, kind: "MANUAL", debit: "1", credit: "1", description: "x", source: "USER", reason: "x" } }),
      ),
    ).rejects.toThrow();

    // Başka mükellefin hesabı
    const otherTaxpayer = (await createTaxpayer(ctx, { title: "Diğer Mükellef", taxId: uniqueVkn() })).id;
    await initChartFromTemplate(ctx, otherTaxpayer);
    const foreign = (await getChart(ctx, otherTaxpayer)).accounts.find((a) => a.code === "770")!.id;
    await expect(
      withTenant(t, (tx) =>
        tx.journalEntryLine.create({ data: { organizationId: ctx.organizationId, entryId: draft.id, lineNo: 4, kind: "MANUAL", accountId: foreign, debit: "10", description: "x", source: "USER", reason: "x" } }),
      ),
    ).rejects.toThrow(/hesap planında değil/);
    // Taslak silinebilir
    await withTenant(t, (tx) => tx.journalEntry.delete({ where: { id: draft.id } }));
  });

  it("ters kayıt: borç/alacak yer değiştirir ve kesinleşir, asıl fiş iptal, belge yeniden öneri bekler", async () => {
    await expect(reverseEntry(ctx, firstEntryId, { reason: "x" })).rejects.toThrow();
    const result = await reverseEntry(ctx, firstEntryId, { reason: "Yanlış dönem" });
    expect(result.reversalNo).toBe(3);
    expect(result.newDraftId).not.toBeNull();

    const journal = await getDocumentJournal(ctx, firstDoc);
    const original = journal.entries.find((e) => e.id === firstEntryId)!;
    const reversal = journal.entries.find((e) => e.reversalOfId === firstEntryId)!;
    expect(original.status).toBe("REVERSED");
    expect(reversal.status).toBe("POSTED");
    expect(reversal.lines.map((l) => [l.account?.code, l.debit.toFixed(2), l.credit.toFixed(2)])).toEqual([
      ["770", "0.00", "1000.00"],
      ["191", "0.00", "200.00"],
      ["320", "1200.00", "0.00"],
    ]);
    expect((await getDocument(ctx, firstDoc)).status).toBe("ACCOUNTING_PENDING");
    // Yeni öneri artık öğrenilen kuralı kullanır
    const draft = (await activeEntry(ctx, firstDoc))!;
    expect(draft.lines.find((l) => l.kind === "MAIN")).toMatchObject({ source: "POSTING_RULE" });
    await expect(reverseEntry(ctx, reversal.id, { reason: "ters kaydın tersi" })).rejects.toThrow(/Ters kayıt iptal edilemez/);

    const all = await listJournal(ctx, taxpayerId, { status: "POSTED" });
    expect(all.entries.map((e) => e.entryNo)).toEqual([2, 3]);
  });

  it("kapalı dönemde fiş kesinleşmez", async () => {
    const draft = (await activeEntry(ctx, firstDoc))!;
    await setFiscalPeriodStatus(ctx, taxpayerId, periodId, "CLOSED");
    await expect(postEntry(ctx, draft.id, { version: draft.version })).rejects.toThrow(/kapalı/);
    await setFiscalPeriodStatus(ctx, taxpayerId, periodId, "OPEN");
  });

  it("alt hesap: üst hesap olmadan açılamaz; aynı kod iki kez açılamaz", async () => {
    await expect(createAccount(ctx, taxpayerId, { code: "999.01", name: "Olmayan üst" })).rejects.toThrow(/Üst hesap 999/);
    await createAccount(ctx, taxpayerId, { code: "770.01", name: "Kira giderleri" });
    await expect(createAccount(ctx, taxpayerId, { code: "770.01", name: "Tekrar" })).rejects.toThrow(/zaten var/);
    await expect(createAccount(ctx, taxpayerId, { code: "77", name: "Kısa kod" })).rejects.toThrow();
  });
});

describe("muhasebe yetki ve izolasyon (PostgreSQL)", () => {
  it("başka ofis hesap planını, fişleri ve belgenin fişini göremez", async () => {
    await expect(getChart(other, taxpayerId)).rejects.toThrow("Mükellef bulunamadı");
    await expect(listJournal(other, taxpayerId)).rejects.toThrow("Mükellef bulunamadı");
    const anyEntry = await withTenant({ organizationId: ctx.organizationId }, (tx) => tx.journalEntry.findFirstOrThrow({ where: { taxpayerId } }));
    await expect(getDocumentJournal(other, anyEntry.documentId!)).rejects.toThrow("Belge bulunamadı");
    await expect(postEntry(other, anyEntry.id, { version: 1 })).rejects.toThrow("Fiş bulunamadı");
    const raw = await withTenant({ organizationId: other.organizationId }, (tx) => tx.journalEntry.count({ where: { taxpayerId } }));
    expect(raw).toBe(0);
  });

  it("personel taslağı düzenleyebilir ama kesinleştiremez; atanmamış personel göremez", async () => {
    const doc = await reviewedInvoice("DFT2026000000009");
    const entry = (await activeEntry(ctx, doc))!;
    const staff = await member("STAFF", true);
    const main = entry.lines.find((l) => l.kind === "MAIN")!;
    await updateDraft(staff, entry.id, { version: entry.version, lines: [{ id: main.id, accountId: main.accountId }] });
    await expect(postEntry(staff, entry.id, { version: entry.version + 1 })).rejects.toThrow(/yetki/i);
    await expect(createAccount(staff, taxpayerId, { code: "770.02", name: "Personel denemesi" })).rejects.toThrow(/yetki/i);

    const outsider = await member("STAFF", false);
    await expect(getDocumentJournal(outsider, doc)).rejects.toThrow("Belge bulunamadı");
    await expect(updateDraft(outsider, entry.id, { version: entry.version + 1, lines: [{ id: main.id, accountId: null }] })).rejects.toThrow("Fiş bulunamadı");
  });
});
