// Gerçek PostgreSQL gerektirir: npm run db:up && npm run db:deploy && npm run test:integration
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { turkishCsv } from "@/test/bankFixture";
import { makeVkn, uniqueEmail, uniqueVkn } from "@/test/fixtures";
import { encode, ublInvoiceXml } from "@/test/ublFixture";
import { login, registerOffice } from "@/server/auth/authService";
import { JOB_HANDLERS } from "@/server/documents/documentProcessor";
import { markReviewed } from "@/server/documents/documentService";
import { uploadDocuments } from "@/server/documents/documentUploadService";
import { runPendingJobs } from "@/server/jobs/jobQueue";
import { createAccount, getChart, initChartFromTemplate, setRoleMapping } from "@/server/ledger/chartService";
import { getDocumentJournal, postEntry, reverseEntry } from "@/server/ledger/journalService";
import { resolveContext, type RequestContext } from "@/server/tenancy/context";
import { addMember } from "@/server/tenancy/memberService";
import { withTenant } from "@/server/tenancy/tenantDb";
import { createFiscalPeriod } from "@/server/taxpayers/fiscalPeriodService";
import { assignMember, createTaxpayer } from "@/server/taxpayers/taxpayerService";
import {
  classifyTransaction,
  createBankAccount,
  getBankAccountDetail,
  importStatement,
  listBankAccounts,
  matchToInvoice,
  normalizeIban,
  previewStatement,
  setIgnored,
} from "./bankService";

process.env.STORAGE_DIR = mkdtempSync(path.join(tmpdir(), "mihsap-bank-storage-"));

const PASSWORD = "test-parolasi-123";
const orgs: string[] = [];
const users: string[] = [];
let ctx: RequestContext;
let other: RequestContext;
let taxpayerId: string;
let taxpayerVkn: string;
let bankAccountId: string;
let purchaseDoc: string;
let saleDoc: string;
const SUPPLIER = makeVkn("888888889");
const CUSTOMER = makeVkn("999999990");

/** Geçerli kontrol basamaklı sentetik TR IBAN */
function testIban(account: string) {
  const bban = `00061${"0"}${account.padStart(16, "0")}`;
  const numeric = `${bban}292700`;
  let mod = 0;
  for (const ch of numeric) mod = (mod * 10 + Number(ch)) % 97;
  return `TR${String(98 - mod).padStart(2, "0")}${bban}`;
}

async function office(label: string) {
  const r = await registerOffice({ organizationName: `${label} Ofis`, fullName: `${label} Sahibi`, email: uniqueEmail(label), password: PASSWORD });
  orgs.push(r.organizationId);
  users.push(r.userId);
  return (await resolveContext(r.token))!;
}

/** Fatura yükle → işle → kontrol edildi → fişi kesinleştir */
async function postedInvoice(invoiceNo: string, opts: Partial<Parameters<typeof ublInvoiceXml>[0]>) {
  const [r] = await uploadDocuments(ctx, taxpayerId, [{ name: `${invoiceNo}.xml`, data: encode(ublInvoiceXml({ invoiceNo, supplierTaxId: SUPPLIER, customerTaxId: taxpayerVkn, ...opts })) }]);
  await runPendingJobs(JOB_HANDLERS, 50, "test-worker");
  await markReviewed(ctx, r.documentId!);
  const entry = (await getDocumentJournal(ctx, r.documentId!)).entries[0];
  await postEntry(ctx, entry.id, { version: entry.version });
  return r.documentId!;
}

const csvFile = (name: string, rows: Parameters<typeof turkishCsv>[0]) => ({ name, data: turkishCsv(rows) });

beforeAll(async () => {
  ctx = await office("bankaA");
  other = await office("bankaB");
  taxpayerVkn = uniqueVkn();
  taxpayerId = (await createTaxpayer(ctx, { title: "Banka Test A.Ş.", taxId: taxpayerVkn })).id;
  await createFiscalPeriod(ctx, taxpayerId, { name: "2026", startDate: "2026-01-01", endDate: "2026-12-31" });
  await initChartFromTemplate(ctx, taxpayerId);
  const chart = await getChart(ctx, taxpayerId);
  await setRoleMapping(ctx, taxpayerId, { role: "PURCHASE_DEFAULT", accountId: chart.accounts.find((a) => a.code === "770")!.id });
  // Alış: 1000 + %20 = 1200; satış: 2000 + %20 = 2400
  purchaseDoc = await postedInvoice("ALS2026000000001", { issueDate: "2026-10-02" });
  saleDoc = await postedInvoice("STS2026000000001", {
    supplierTaxId: taxpayerVkn,
    customerTaxId: CUSTOMER,
    customerName: "ÖRNEK ALICI LTD. ŞTİ.",
    issueDate: "2026-10-03",
    lines: [{ name: "Danışmanlık", amount: "2000.00", vatRate: "20", vatAmount: "400.00" }],
  });
});

afterAll(async () => {
  for (const id of orgs) await withTenant({ organizationId: id }, (tx) => tx.organization.deleteMany({ where: { id } }));
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
});

describe("banka mutabakatı (PostgreSQL)", () => {
  const october = csvFile("ekim.csv", [
    ["01.10.2026", "DEVİR", "", "5.000,00", "5.000,00"],
    ["05.10.2026", "EFT ÖRNEK TEDARİK FT ALS2026000000001", "1.200,00", "", "3.800,00"],
    ["06.10.2026", "HAVALE ÖRNEK ALICI LTD", "", "2.400,00", "6.200,00"],
    ["06.10.2026", "EFT ÜCRETİ", "6,50", "", "6.193,50"],
  ]);

  it("banka hesabı: IBAN kontrol basamağı doğrulanır, defter hesabı mükellefin planından", async () => {
    expect(() => normalizeIban("TR00 0006 1000 0000 0000 0000 01")).toThrow(/kontrol basamağı/);
    const ledger102 = await createAccount(ctx, taxpayerId, { code: "102.01", name: "Örnek Banka TL" });
    const iban = testIban("123");
    const account = await createBankAccount(ctx, taxpayerId, { name: "Örnek Banka TL", bankName: "Örnek Bankası", iban: iban.replace(/(.{4})/g, "$1 "), ledgerAccountId: ledger102.id });
    expect(account.iban).toBe(iban);
    bankAccountId = account.id;
    await expect(createBankAccount(ctx, taxpayerId, { name: "Örnek Banka TL", ledgerAccountId: ledger102.id })).rejects.toThrow(/zaten var/);
  });

  it("önizleme: sütunlar tahmin edilir, bakiye tutar, hiçbir şey kaydedilmez", async () => {
    const preview = await previewStatement(ctx, bankAccountId, october);
    expect(preview).toMatchObject({ format: "CSV", rowCount: 4, errorCount: 0, duplicates: 0, balance: { status: "OK", opening: "0.00", closing: "6193.50" } });
    expect(preview.mapping).toMatchObject({ date: 0, description: 1, debit: 2, credit: 3, balance: 4 });
    expect((await getBankAccountDetail(ctx, bankAccountId)).transactions).toHaveLength(0);
  });

  it("aktarım; aynı dosya ikinci kez aktarılamaz; çakışan ekstrede aynı hareketler atlanır", async () => {
    const preview = await previewStatement(ctx, bankAccountId, october);
    const result = await importStatement(ctx, bankAccountId, october, preview.mapping);
    expect(result).toMatchObject({ rowCount: 4, imported: 4, duplicates: 0, balanceCheck: "OK" });
    await expect(importStatement(ctx, bankAccountId, october, preview.mapping)).rejects.toThrow(/zaten aktarıldı/);

    const overlap = csvFile("ekim-2.csv", [
      ["06.10.2026", "EFT ÜCRETİ", "6,50", "", "6.193,50"],
      ["08.10.2026", "EFT ÜCRETİ", "6,50", "", "6.187,00"],
    ]);
    const second = await importStatement(ctx, bankAccountId, overlap, preview.mapping);
    expect(second).toMatchObject({ rowCount: 2, imported: 1, duplicates: 1 });
    expect(second.findings.map((f) => f.code)).toContain("DUPLICATES_SKIPPED");
  });

  it("öneriler gerekçeli: ödeme alış faturasına, tahsilat satış faturasına; masrafa öneri yok", async () => {
    const detail = await getBankAccountDetail(ctx, bankAccountId);
    const by = (desc: string) => detail.transactions.find((t) => t.description === desc)!;
    expect(by("EFT ÖRNEK TEDARİK FT ALS2026000000001").suggestion).toMatchObject({ kind: "INVOICE", documentId: purchaseDoc, confidence: "high" });
    expect(by("EFT ÖRNEK TEDARİK FT ALS2026000000001").suggestion!.reasons).toContain("Açıklamada fatura no ALS2026000000001 geçiyor");
    expect(by("HAVALE ÖRNEK ALICI LTD").suggestion).toMatchObject({ kind: "INVOICE", documentId: saleDoc });
    expect(detail.transactions.filter((t) => t.description === "EFT ÜCRETİ").every((t) => t.suggestion === null)).toBe(true);
  });

  it("fatura eşleştirme: 320 B / 102.01 A fişi kesinleşir; fatura tekrar önerilmez; ikinci eşleştirme reddedilir", async () => {
    const detail = await getBankAccountDetail(ctx, bankAccountId);
    const payment = detail.transactions.find((t) => t.description.includes("ALS2026000000001"))!;
    const result = await matchToInvoice(ctx, payment.id, purchaseDoc);
    const entry = await withTenant({ organizationId: ctx.organizationId }, (tx) =>
      tx.journalEntry.findUniqueOrThrow({ where: { id: result.entryId }, include: { lines: { include: { account: true }, orderBy: { lineNo: "asc" } } } }),
    );
    expect(entry).toMatchObject({ status: "POSTED", source: "BANK" });
    expect(entry.lines.map((l) => [l.account?.code, l.debit.toFixed(2), l.credit.toFixed(2)])).toEqual([
      ["320", "1200.00", "0.00"],
      ["102.01", "0.00", "1200.00"],
    ]);
    const after = await getBankAccountDetail(ctx, bankAccountId);
    expect(after.transactions.find((t) => t.id === payment.id)).toMatchObject({ status: "MATCHED", matchedDocumentId: purchaseDoc });
    await expect(matchToInvoice(ctx, payment.id, purchaseDoc)).rejects.toThrow(/zaten işlenmiş/);

    const collection = after.transactions.find((t) => t.description === "HAVALE ÖRNEK ALICI LTD")!;
    await expect(matchToInvoice(ctx, collection.id, purchaseDoc)).rejects.toThrow(/Giriş hareketi yalnızca satış/);
    await matchToInvoice(ctx, collection.id, saleDoc);
  });

  it("sınıflandırma + kural: masraf 780'e işlenir, aynı açıklamalı sonraki hareket kuralla önerilir", async () => {
    const chart = await getChart(ctx, taxpayerId);
    const acc780 = chart.accounts.find((a) => a.code === "780")!.id;
    const detail = await getBankAccountDetail(ctx, bankAccountId, { status: "UNMATCHED" });
    const [first, second] = detail.transactions.filter((t) => t.description === "EFT ÜCRETİ");
    await classifyTransaction(ctx, first.id, { accountId: acc780, saveKeyword: "EFT ÜCRETİ" });
    const refreshed = await getBankAccountDetail(ctx, bankAccountId, { status: "UNMATCHED" });
    const next = refreshed.transactions.find((t) => t.id === second.id)!;
    expect(next.suggestion).toMatchObject({ kind: "RULE", account: { code: "780" } });
    await classifyTransaction(ctx, next.id, { accountId: acc780, ruleId: next.suggestion!.kind === "RULE" ? next.suggestion!.ruleId : undefined });
    expect((await getBankAccountDetail(ctx, bankAccountId)).counts).toMatchObject({ MATCHED: 4 });
  });

  it("eşleşme fişi ters kayıtla iptal edilince hareket yeniden bekler; ekstre verisi değiştirilemez", async () => {
    const t = (await getBankAccountDetail(ctx, bankAccountId)).transactions.find((x) => x.matchedDocumentId === purchaseDoc)!;
    await reverseEntry(ctx, t.journalEntryId!, { reason: "Yanlış eşleşme" });
    const back = (await getBankAccountDetail(ctx, bankAccountId)).transactions.find((x) => x.id === t.id)!;
    expect(back).toMatchObject({ status: "UNMATCHED", journalEntryId: null, matchedDocumentId: null });
    expect(back.suggestion).toMatchObject({ kind: "INVOICE", documentId: purchaseDoc });

    await expect(withTenant({ organizationId: ctx.organizationId }, (tx) => tx.bankTransaction.update({ where: { id: t.id }, data: { amount: "-1.00" } }))).rejects.toThrow(/değiştirilemez/);
    await expect(withTenant({ organizationId: ctx.organizationId }, (tx) => tx.bankTransaction.deleteMany({ where: { id: t.id } }))).rejects.toThrow();
  });

  it("bakiye tutmayan ekstre aktarılır ama hata bulgusuyla işaretlenir", async () => {
    const bad = csvFile("kasim.csv", [
      ["01.11.2026", "A", "", "100,00", "6.287,00"],
      ["02.11.2026", "B", "30,00", "", "6.250,00"],
    ]);
    const preview = await previewStatement(ctx, bankAccountId, bad);
    expect(preview.balance).toMatchObject({ status: "MISMATCH", mismatches: [{ rowNo: 6, expected: "6257.00", actual: "6250.00" }] });
    const result = await importStatement(ctx, bankAccountId, bad, preview.mapping);
    expect(result.balanceCheck).toBe("MISMATCH");
    expect(result.findings.map((f) => f.code)).toEqual(["BALANCE_MISMATCH"]);
  });
});

describe("banka yetki ve izolasyon (PostgreSQL)", () => {
  it("başka ofis hesabı ve hareketleri göremez", async () => {
    await expect(listBankAccounts(other, taxpayerId)).rejects.toThrow("Mükellef bulunamadı");
    await expect(getBankAccountDetail(other, bankAccountId)).rejects.toThrow("Banka hesabı bulunamadı");
    const anyTx = await withTenant({ organizationId: ctx.organizationId }, (tx) => tx.bankTransaction.findFirstOrThrow({ where: { bankAccountId } }));
    await expect(setIgnored(other, anyTx.id, true)).rejects.toThrow("Banka hareketi bulunamadı");
    expect(await withTenant({ organizationId: other.organizationId }, (tx) => tx.bankTransaction.count())).toBe(0);
  });

  it("personel ekstre aktarıp yok sayabilir ama fiş oluşturamaz", async () => {
    const email = uniqueEmail("bankstaff");
    const { membership, temporaryPassword } = await addMember(ctx, { email, fullName: "Banka Personel", role: "STAFF" });
    users.push(membership.userId);
    await assignMember(ctx, taxpayerId, { membershipId: membership.id });
    const staff = (await resolveContext((await login({ email, password: temporaryPassword! })).token))!;
    const pending = (await getBankAccountDetail(staff, bankAccountId, { status: "UNMATCHED" })).transactions[0];
    await setIgnored(staff, pending.id, true);
    await setIgnored(staff, pending.id, false);
    await expect(matchToInvoice(staff, pending.id, purchaseDoc)).rejects.toThrow(/yetki/i);
    const chart = await getChart(ctx, taxpayerId);
    await expect(classifyTransaction(staff, pending.id, { accountId: chart.accounts.find((a) => a.code === "780")!.id })).rejects.toThrow(/yetki/i);
    await expect(createBankAccount(staff, taxpayerId, { name: "Personel hesabı", ledgerAccountId: chart.accounts.find((a) => a.code === "102")!.id })).rejects.toThrow(/yetki/i);
  });
});
