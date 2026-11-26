import { createHash } from "node:crypto";
import { Prisma, type BankTransactionStatus } from "@prisma/client";
import Decimal from "decimal.js";
import { z } from "zod";
import { audit } from "@/server/audit/auditService";
import { AppError, notFound } from "@/server/errors";
import { createPostedEntry } from "@/server/ledger/journalService";
import { assertPermission, tenantScope, type RequestContext } from "@/server/tenancy/context";
import { withTenant, type Tx } from "@/server/tenancy/tenantDb";
import { getAccessibleTaxpayer, taxpayerVisibility } from "@/server/taxpayers/taxpayerService";
import { suggest, type InvoiceCandidate, type RuleCandidate, type Suggestion } from "./matchEngine";
import {
  checkBalances,
  detectMapping,
  extractRows,
  fingerprints,
  readTable,
  StatementError,
  type Mapping,
  type StatementRow,
  type Table,
} from "./statementParser";

const auditBase = (ctx: RequestContext, taxpayerId: string) => ({ organizationId: ctx.organizationId, actorUserId: ctx.userId, taxpayerId, ipAddress: ctx.ipAddress });
const d = (v: Prisma.Decimal | string | number) => new Decimal(v.toString());

// ---------------------------------------------------------------- banka hesapları

/** TR IBAN: 26 karakter, mod-97 kontrol basamağı */
export function normalizeIban(raw: string) {
  const iban = raw.replace(/\s+/g, "").toUpperCase();
  if (!/^TR\d{24}$/.test(iban)) throw new AppError("VALIDATION_ERROR", "IBAN TR ile başlayan 26 karakter olmalı");
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  const numeric = rearranged.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let mod = 0;
  for (const ch of numeric) mod = (mod * 10 + Number(ch)) % 97;
  if (mod !== 1) throw new AppError("VALIDATION_ERROR", "IBAN kontrol basamağı tutmuyor");
  return iban;
}

export const bankAccountSchema = z.object({
  name: z.string().trim().min(2, "Hesap adı en az 2 karakter").max(120),
  bankName: z.string().trim().max(120).optional().nullable(),
  iban: z.string().trim().optional().nullable(),
  ledgerAccountId: z.uuid("Defter hesabı seçin"),
});

export async function listBankAccounts(ctx: RequestContext, taxpayerId: string) {
  assertPermission(ctx, "bank:read");
  return withTenant(tenantScope(ctx), async (tx) => {
    const taxpayer = await getAccessibleTaxpayer(tx, ctx, taxpayerId);
    const [accounts, pending, ledgerAccounts] = await Promise.all([
      tx.bankAccount.findMany({
        where: { taxpayerId: taxpayer.id },
        include: {
          ledgerAccount: { select: { code: true, name: true } },
          statements: { orderBy: { periodEnd: "desc" }, take: 1, select: { periodEnd: true, closingBalance: true, balanceCheck: true } },
        },
        orderBy: { name: "asc" },
      }),
      tx.bankTransaction.groupBy({ by: ["bankAccountId"], where: { taxpayerId: taxpayer.id, status: "UNMATCHED" }, _count: { _all: true } }),
      tx.ledgerAccount.findMany({
        where: { taxpayerId: taxpayer.id, isActive: true, isPostable: true, code: { startsWith: "10" } },
        select: { id: true, code: true, name: true },
        orderBy: { code: "asc" },
      }),
    ]);
    const pendingBy = new Map(pending.map((p) => [p.bankAccountId, p._count._all]));
    return {
      taxpayer: { id: taxpayer.id, title: taxpayer.title },
      accounts: accounts.map((a) => ({ ...a, pending: pendingBy.get(a.id) ?? 0, lastStatement: a.statements[0] ?? null })),
      ledgerAccounts,
    };
  });
}

export async function createBankAccount(ctx: RequestContext, taxpayerId: string, input: z.input<typeof bankAccountSchema>) {
  assertPermission(ctx, "bank:manage");
  const data = bankAccountSchema.parse(input);
  const iban = data.iban ? normalizeIban(data.iban) : null;
  return withTenant(tenantScope(ctx), async (tx) => {
    const taxpayer = await getAccessibleTaxpayer(tx, ctx, taxpayerId);
    const ledger = await tx.ledgerAccount.findFirst({ where: { id: data.ledgerAccountId, taxpayerId: taxpayer.id, isActive: true, isPostable: true } });
    if (!ledger) throw new AppError("VALIDATION_ERROR", "Defter hesabı bu mükellefin hesap planında yok veya kayıt yapılamaz");
    try {
      const account = await tx.bankAccount.create({
        data: { organizationId: ctx.organizationId, taxpayerId: taxpayer.id, name: data.name, bankName: data.bankName || null, iban, ledgerAccountId: ledger.id },
      });
      await audit(tx, { ...auditBase(ctx, taxpayer.id), action: "bank.account_create", resourceType: "bank_account", resourceId: account.id, details: { name: data.name, ledger: ledger.code } });
      return account;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new AppError("CONFLICT", "Bu adla bir banka hesabı zaten var");
      throw error;
    }
  });
}

async function getAccessibleBankAccount(tx: Tx, ctx: RequestContext, bankAccountId: string) {
  const parsed = z.uuid().safeParse(bankAccountId);
  const account = parsed.success
    ? await tx.bankAccount.findFirst({
        where: { id: parsed.data, organizationId: ctx.organizationId, taxpayer: taxpayerVisibility(ctx) },
        include: { ledgerAccount: true, taxpayer: { select: { id: true, title: true } } },
      })
    : null;
  if (!account) throw notFound("Banka hesabı");
  return account;
}

// ---------------------------------------------------------------- ekstre önizleme / aktarım

const col = z.number().int().min(0).max(199).optional();
const mappingSchema = z
  .object({
    headerRow: z.number().int().min(0).max(1000),
    invertSign: z.boolean().optional(),
    date: col,
    valueDate: col,
    description: col,
    amount: col,
    debit: col,
    credit: col,
    balance: col,
    reference: col,
  })
  .refine((m) => m.date !== undefined, "Tarih sütununu seçin")
  .refine((m) => m.amount !== undefined || (m.debit !== undefined && m.credit !== undefined), "Tutar sütununu ya da borç ve alacak sütunlarını seçin");

export interface StatementFile {
  name: string;
  data: Uint8Array;
}

interface Analysis {
  format: "CSV" | "XLSX";
  table: Table;
  mapping: Mapping | null;
  rows: StatementRow[];
  errors: Array<{ rowNo: number; message: string }>;
  skipped: number;
  balance: ReturnType<typeof checkBalances> | null;
  prints: string[];
}

function analyze(file: StatementFile, mappingInput: unknown): Analysis {
  let parsed;
  try {
    parsed = readTable(file.name, file.data);
  } catch (e) {
    if (e instanceof StatementError) throw new AppError("VALIDATION_ERROR", e.message);
    throw e;
  }
  const mapping = mappingInput ? (mappingSchema.parse(mappingInput) as Mapping) : detectMapping(parsed.table);
  if (!mapping) return { ...parsed, mapping: null, rows: [], errors: [], skipped: 0, balance: null, prints: [] };
  let extracted;
  try {
    extracted = extractRows(parsed.table, mapping, parsed.format);
  } catch (e) {
    if (e instanceof StatementError) throw new AppError("VALIDATION_ERROR", e.message);
    throw e;
  }
  const balance = checkBalances(extracted.rows);
  return { ...parsed, mapping, ...extracted, balance, rows: balance.ordered, prints: fingerprints(balance.ordered) };
}

const rowView = (r: StatementRow) => ({
  rowNo: r.rowNo,
  txDate: r.txDate.toISOString().slice(0, 10),
  description: r.description,
  reference: r.reference,
  amount: r.amount.toFixed(2),
  balance: r.balance?.toFixed(2) ?? null,
});

/** Dosyayı okur, sütunları tahmin eder (veya verilen eşlemeyi kullanır); hiçbir şey kaydetmez. */
export async function previewStatement(ctx: RequestContext, bankAccountId: string, file: StatementFile, mappingInput?: unknown) {
  assertPermission(ctx, "bank:import");
  const a = analyze(file, mappingInput);
  return withTenant(tenantScope(ctx), async (tx) => {
    const account = await getAccessibleBankAccount(tx, ctx, bankAccountId);
    const existing = a.prints.length
      ? await tx.bankTransaction.count({ where: { bankAccountId: account.id, fingerprint: { in: a.prints } } })
      : 0;
    return {
      format: a.format,
      // Eşleme seçimi için ilk satırlar (başlık bulunamadıysa kullanıcı buradan seçer)
      table: a.table.slice(0, 30).map((r) => r.slice(0, 15)),
      mapping: a.mapping,
      rows: a.rows.slice(0, 50).map(rowView),
      rowCount: a.rows.length,
      errors: a.errors.slice(0, 20),
      errorCount: a.errors.length,
      skipped: a.skipped,
      duplicates: existing,
      balance: a.balance
        ? { status: a.balance.status, opening: a.balance.opening?.toFixed(2) ?? null, closing: a.balance.closing?.toFixed(2) ?? null, mismatches: a.balance.mismatches.slice(0, 20) }
        : null,
    };
  });
}

/**
 * Ekstreyi aktarır. Okunamayan satır varsa aktarım yapılmaz (eşleme düzeltilmeli).
 * Aynı dosya ikinci kez aktarılamaz; çakışan dönemdeki aynı hareketler (parmak izi) atlanır.
 */
export async function importStatement(ctx: RequestContext, bankAccountId: string, file: StatementFile, mappingInput: unknown) {
  assertPermission(ctx, "bank:import");
  const a = analyze(file, mappingInput);
  if (!a.mapping) throw new AppError("VALIDATION_ERROR", "Sütun eşlemesi gerekli");
  if (a.errors.length > 0) throw new AppError("VALIDATION_ERROR", `${a.errors.length} satır okunamadı (ilk: satır ${a.errors[0].rowNo} — ${a.errors[0].message}); sütun eşlemesini kontrol edin`);
  if (a.rows.length === 0) throw new AppError("VALIDATION_ERROR", "Ekstrede aktarılacak hareket bulunamadı");
  const sha256 = createHash("sha256").update(file.data).digest("hex");
  const balance = a.balance!;

  return withTenant(tenantScope(ctx), async (tx) => {
    const account = await getAccessibleBankAccount(tx, ctx, bankAccountId);
    if (!account.isActive) throw new AppError("CONFLICT", "Banka hesabı pasif");
    if (await tx.bankStatement.findUnique({ where: { bankAccountId_sha256: { bankAccountId: account.id, sha256 } } })) {
      throw new AppError("CONFLICT", "Bu ekstre dosyası bu hesaba zaten aktarıldı");
    }
    const periodStart = a.rows.reduce((m, r) => (r.txDate < m ? r.txDate : m), a.rows[0].txDate);
    const periodEnd = a.rows.reduce((m, r) => (r.txDate > m ? r.txDate : m), a.rows[0].txDate);

    const findings: Array<{ code: string; severity: "error" | "warning"; message: string }> = [];
    if (balance.status === "MISMATCH") {
      findings.push({ code: "BALANCE_MISMATCH", severity: "error", message: `${balance.mismatches.length} satırda bakiye tutmuyor (ilk: satır ${balance.mismatches[0].rowNo}, beklenen ${balance.mismatches[0].expected}, ekstrede ${balance.mismatches[0].actual})` });
    }
    if (balance.status === "NO_BALANCE") findings.push({ code: "NO_BALANCE", severity: "warning", message: "Ekstrede bakiye sütunu yok; bakiye kontrolü yapılamadı" });
    // Süreklilik: önceki ekstrenin kapanışı bu ekstrenin açılışına eşit olmalı
    if (balance.opening) {
      const previous = await tx.bankStatement.findFirst({
        where: { bankAccountId: account.id, periodEnd: { lte: periodStart }, closingBalance: { not: null } },
        orderBy: { periodEnd: "desc" },
      });
      if (previous && !d(previous.closingBalance!).eq(balance.opening)) {
        findings.push({
          code: "CONTINUITY_GAP",
          severity: "warning",
          message: `Önceki ekstrenin kapanış bakiyesi ${d(previous.closingBalance!).toFixed(2)}, bu ekstrenin açılışı ${balance.opening.toFixed(2)}: arada aktarılmamış hareket olabilir`,
        });
      }
    }
    for (const e of a.errors) findings.push({ code: "ROW_ERROR", severity: "error", message: `Satır ${e.rowNo}: ${e.message}` });

    const existing = new Set(
      (await tx.bankTransaction.findMany({ where: { bankAccountId: account.id, fingerprint: { in: a.prints } }, select: { fingerprint: true } })).map((t) => t.fingerprint),
    );
    const fresh = a.rows.map((r, i) => ({ r, fp: a.prints[i] })).filter(({ fp }) => !existing.has(fp));
    if (existing.size > 0) findings.push({ code: "DUPLICATES_SKIPPED", severity: "warning", message: `${existing.size} hareket daha önce aktarılmış; atlandı` });

    const statement = await tx.bankStatement.create({
      data: {
        organizationId: ctx.organizationId,
        taxpayerId: account.taxpayerId,
        bankAccountId: account.id,
        fileName: file.name.slice(0, 255),
        sha256,
        format: a.format,
        periodStart,
        periodEnd,
        openingBalance: balance.opening?.toFixed(2) ?? null,
        closingBalance: balance.closing?.toFixed(2) ?? null,
        rowCount: a.rows.length,
        importedCount: fresh.length,
        duplicateCount: a.rows.length - fresh.length,
        balanceCheck: balance.status,
        mapping: a.mapping as unknown as Prisma.InputJsonValue,
        findings: findings as unknown as Prisma.InputJsonValue,
        createdBy: ctx.userId,
      },
    });
    if (fresh.length > 0) {
      await tx.bankTransaction.createMany({
        data: fresh.map(({ r, fp }) => ({
          organizationId: ctx.organizationId,
          taxpayerId: account.taxpayerId,
          bankAccountId: account.id,
          statementId: statement.id,
          rowNo: r.rowNo,
          txDate: r.txDate,
          valueDate: r.valueDate,
          description: r.description,
          reference: r.reference,
          amount: r.amount.toFixed(2),
          balance: r.balance?.toFixed(2) ?? null,
          fingerprint: fp,
        })),
      });
    }
    await audit(tx, {
      ...auditBase(ctx, account.taxpayerId),
      action: "bank.import",
      resourceType: "bank_statement",
      resourceId: statement.id,
      details: { file: file.name.slice(0, 100), rows: a.rows.length, imported: fresh.length, balance: balance.status },
    });
    return { statementId: statement.id, rowCount: a.rows.length, imported: fresh.length, duplicates: a.rows.length - fresh.length, balanceCheck: balance.status, findings };
  });
}

// ---------------------------------------------------------------- hareketler ve öneriler

/** Eşleşmemiş, kesin fişi olan (iptal edilmemiş) faturalar — öneri adayları */
async function invoiceCandidates(tx: Tx, taxpayerId: string): Promise<InvoiceCandidate[]> {
  const invoices = await tx.invoice.findMany({
    where: {
      taxpayerId,
      currency: "TRY",
      invoiceTypeCode: { not: "IADE" },
      document: {
        journal: { some: { status: "POSTED", reversalOfId: null } },
        bankMatches: { none: { status: "MATCHED" } },
      },
    },
    select: { documentId: true, direction: true, invoiceNo: true, issueDate: true, payableAmount: true, supplierTaxId: true, supplierName: true, customerTaxId: true, customerName: true },
    orderBy: { issueDate: "desc" },
    take: 2000,
  });
  return invoices.map((i) => ({
    documentId: i.documentId,
    direction: i.direction,
    invoiceNo: i.invoiceNo,
    issueDate: i.issueDate,
    payable: d(i.payableAmount),
    counterpartyTaxId: i.direction === "PURCHASE" ? i.supplierTaxId : i.customerTaxId,
    counterpartyName: i.direction === "PURCHASE" ? i.supplierName : i.customerName,
  }));
}

async function ruleCandidates(tx: Tx, taxpayerId: string): Promise<RuleCandidate[]> {
  const rules = await tx.bankRule.findMany({ where: { taxpayerId, isActive: true, account: { isActive: true, isPostable: true } }, include: { account: { select: { id: true, code: true, name: true } } } });
  return rules.map((r) => ({ id: r.id, keyword: r.keyword, direction: r.direction, account: r.account }));
}

const STATUSES = ["UNMATCHED", "MATCHED", "IGNORED"] as const satisfies readonly BankTransactionStatus[];
export const transactionQuerySchema = z.object({ status: z.enum(STATUSES).optional() });

export async function getBankAccountDetail(ctx: RequestContext, bankAccountId: string, input: z.input<typeof transactionQuerySchema> = {}) {
  assertPermission(ctx, "bank:read");
  const q = transactionQuerySchema.parse(input);
  return withTenant(tenantScope(ctx), async (tx) => {
    const account = await getAccessibleBankAccount(tx, ctx, bankAccountId);
    const [statements, transactions, counts, invoices, rules, accounts, ruleList] = await Promise.all([
      tx.bankStatement.findMany({ where: { bankAccountId: account.id }, orderBy: { periodEnd: "desc" }, take: 24 }),
      tx.bankTransaction.findMany({
        where: { bankAccountId: account.id, ...(q.status ? { status: q.status } : {}) },
        include: {
          journalEntry: { select: { id: true, entryNo: true } },
          matchedDocument: { select: { id: true, documentNo: true, counterpartyName: true } },
        },
        orderBy: [{ txDate: "desc" }, { rowNo: "desc" }],
        take: 300,
      }),
      tx.bankTransaction.groupBy({ by: ["status"], where: { bankAccountId: account.id }, _count: { _all: true } }),
      invoiceCandidates(tx, account.taxpayerId),
      ruleCandidates(tx, account.taxpayerId),
      tx.ledgerAccount.findMany({ where: { taxpayerId: account.taxpayerId, isActive: true, isPostable: true }, select: { id: true, code: true, name: true }, orderBy: { code: "asc" } }),
      tx.bankRule.findMany({ where: { taxpayerId: account.taxpayerId }, include: { account: { select: { code: true, name: true } } }, orderBy: { keyword: "asc" } }),
    ]);
    const withSuggestions = transactions.map((t) => ({
      ...t,
      suggestion: t.status === "UNMATCHED" ? suggest({ amount: d(t.amount), txDate: t.txDate, description: t.description }, invoices, rules) : null,
    }));
    return {
      account,
      statements,
      transactions: withSuggestions,
      counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])) as Partial<Record<BankTransactionStatus, number>>,
      accounts,
      rules: ruleList,
    };
  });
}

// ---------------------------------------------------------------- mutabakat işlemleri

async function getAccessibleTransaction(tx: Tx, ctx: RequestContext, transactionId: string) {
  const parsed = z.uuid().safeParse(transactionId);
  const t = parsed.success
    ? await tx.bankTransaction.findFirst({
        where: { id: parsed.data, organizationId: ctx.organizationId, taxpayer: taxpayerVisibility(ctx) },
        include: { bankAccount: { include: { ledgerAccount: true } } },
      })
    : null;
  if (!t) throw notFound("Banka hareketi");
  return t;
}

async function openPeriodFor(tx: Tx, taxpayerId: string, date: Date) {
  const period = await tx.fiscalPeriod.findFirst({ where: { taxpayerId, status: "OPEN", startDate: { lte: date }, endDate: { gte: date } } });
  if (!period) throw new AppError("CONFLICT", `${date.toISOString().slice(0, 10)} tarihini kapsayan açık mali dönem yok`);
  return period;
}

const bankLine = (t: { amount: Prisma.Decimal; bankAccount: { ledgerAccountId: string; name: string } }, description: string) => {
  const amount = d(t.amount);
  return {
    accountId: t.bankAccount.ledgerAccountId,
    kind: "BANK" as const,
    debit: amount.isPositive() ? amount : new Decimal(0),
    credit: amount.isNegative() ? amount.abs() : new Decimal(0),
    description: `${t.bankAccount.name} — ${description}`,
    source: "ROLE_MAPPING",
    reason: "Banka hesabının defter hesabı",
  };
};
const counterLine = (amount: Decimal, accountId: string, kind: "COUNTERPARTY" | "MAIN", description: string, source: string, reason: string) => ({
  accountId,
  kind,
  debit: amount.isNegative() ? amount.abs() : new Decimal(0),
  credit: amount.isPositive() ? amount : new Decimal(0),
  description,
  source,
  reason,
});

/** Hareketi faturayla eşleştirir: tahsilat 102 B / 120 A, ödeme 320 B / 102 A (cari hesabı faturanın fişinden). */
export async function matchToInvoice(ctx: RequestContext, transactionId: string, documentId: string) {
  assertPermission(ctx, "journal:post");
  return withTenant(tenantScope(ctx), async (tx) => {
    const t = await getAccessibleTransaction(tx, ctx, transactionId);
    if (t.status !== "UNMATCHED") throw new AppError("CONFLICT", "Hareket zaten işlenmiş");
    const amount = d(t.amount);
    const invoice = await tx.invoice.findFirst({
      where: { documentId: z.uuid().parse(documentId), taxpayerId: t.taxpayerId },
      include: { document: { include: { journal: { where: { status: "POSTED", reversalOfId: null }, include: { lines: { where: { kind: "COUNTERPARTY" } } } } } } },
    });
    if (!invoice) throw notFound("Fatura");
    const posted = invoice.document.journal[0];
    if (!posted) throw new AppError("CONFLICT", "Faturanın kesinleşmiş fişi yok; önce faturayı muhasebeleştirin");
    const expectedDirection = amount.isNegative() ? "PURCHASE" : "SALE";
    if (invoice.direction !== expectedDirection) throw new AppError("VALIDATION_ERROR", amount.isNegative() ? "Çıkış hareketi yalnızca alış faturasıyla eşleşir" : "Giriş hareketi yalnızca satış faturasıyla eşleşir");
    if (!d(invoice.payableAmount).eq(amount.abs())) throw new AppError("VALIDATION_ERROR", "Tutar faturanın ödenecek tutarına eşit değil (kısmi ödeme henüz desteklenmiyor)");
    const counterAccountId = posted.lines[0]?.accountId;
    if (!counterAccountId) throw new AppError("CONFLICT", "Faturanın fişinde cari satırı yok");
    const period = await openPeriodFor(tx, t.taxpayerId, t.txDate);

    const counterparty = invoice.direction === "PURCHASE" ? invoice.supplierName : invoice.customerName;
    const reason = `Fatura ${invoice.invoiceNo} (${counterparty ?? "karşı taraf"}) ${invoice.direction === "PURCHASE" ? "ödemesi" : "tahsilatı"}`;
    const entry = await createPostedEntry(tx, ctx, {
      taxpayerId: t.taxpayerId,
      fiscalPeriodId: period.id,
      entryDate: t.txDate,
      description: `${reason} — ${t.description}`,
      source: "BANK",
      direction: invoice.direction,
      counterpartyTaxId: invoice.direction === "PURCHASE" ? invoice.supplierTaxId : invoice.customerTaxId,
      counterpartyName: counterparty,
      lines: [
        ...(amount.isPositive() ? [bankLine(t, t.description)] : []),
        counterLine(amount, counterAccountId, "COUNTERPARTY", counterparty ?? invoice.invoiceNo, "ROLE_MAPPING", `Faturanın fişindeki cari hesap (yevmiye ${posted.entryNo})`),
        ...(amount.isNegative() ? [bankLine(t, t.description)] : []),
      ],
    });
    try {
      await tx.bankTransaction.update({
        where: { id: t.id },
        data: { status: "MATCHED", journalEntryId: entry.id, matchedDocumentId: invoice.documentId, matchReason: reason, matchedBy: ctx.userId, matchedAt: new Date() },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new AppError("CONFLICT", "Bu fatura başka bir hareketle eşleşmiş");
      throw error;
    }
    await audit(tx, { ...auditBase(ctx, t.taxpayerId), action: "bank.match", resourceType: "bank_transaction", resourceId: t.id, details: { invoiceNo: invoice.invoiceNo, entryNo: entry.entryNo } });
    return { entryId: entry.id, entryNo: entry.entryNo };
  });
}

export const classifySchema = z.object({
  accountId: z.uuid("Hesap seçin"),
  ruleId: z.uuid().optional(),
  /** Bu açıklama kelimesi için kural kaydet */
  saveKeyword: z.string().trim().min(3, "Anahtar kelime en az 3 karakter").max(100).optional(),
});

/** Hareketi doğrudan bir hesaba işler (ör. banka masrafı, vergi ödemesi); istenirse anahtar kelime kuralı öğrenilir. */
export async function classifyTransaction(ctx: RequestContext, transactionId: string, input: z.input<typeof classifySchema>) {
  assertPermission(ctx, "journal:post");
  const data = classifySchema.parse(input);
  return withTenant(tenantScope(ctx), async (tx) => {
    const t = await getAccessibleTransaction(tx, ctx, transactionId);
    if (t.status !== "UNMATCHED") throw new AppError("CONFLICT", "Hareket zaten işlenmiş");
    const account = await tx.ledgerAccount.findFirst({ where: { id: data.accountId, taxpayerId: t.taxpayerId, isActive: true, isPostable: true } });
    if (!account) throw new AppError("VALIDATION_ERROR", "Hesap bu mükellefin hesap planında yok veya kayıt yapılamaz");
    if (account.id === t.bankAccount.ledgerAccountId) throw new AppError("VALIDATION_ERROR", "Karşı hesap bankanın kendi hesabı olamaz");
    const rule = data.ruleId ? await tx.bankRule.findFirst({ where: { id: data.ruleId, taxpayerId: t.taxpayerId } }) : null;
    const period = await openPeriodFor(tx, t.taxpayerId, t.txDate);
    const amount = d(t.amount);
    const reason = rule ? `Kural: "${rule.keyword}" → ${account.code}` : "Kullanıcı sınıflandırdı";

    const entry = await createPostedEntry(tx, ctx, {
      taxpayerId: t.taxpayerId,
      fiscalPeriodId: period.id,
      entryDate: t.txDate,
      description: t.description,
      source: "BANK",
      lines: [
        ...(amount.isPositive() ? [bankLine(t, t.description)] : []),
        counterLine(amount, account.id, "MAIN", t.description, rule ? "POSTING_RULE" : "USER", reason),
        ...(amount.isNegative() ? [bankLine(t, t.description)] : []),
      ],
    });
    if (data.saveKeyword) {
      const direction = amount.isNegative() ? "OUT" : "IN";
      await tx.bankRule.upsert({
        where: { taxpayerId_keyword_direction: { taxpayerId: t.taxpayerId, keyword: data.saveKeyword, direction } },
        create: { organizationId: ctx.organizationId, taxpayerId: t.taxpayerId, keyword: data.saveKeyword, direction, accountId: account.id, createdBy: ctx.userId },
        update: { accountId: account.id, isActive: true },
      });
    }
    await tx.bankTransaction.update({ where: { id: t.id }, data: { status: "MATCHED", journalEntryId: entry.id, matchReason: reason, matchedBy: ctx.userId, matchedAt: new Date() } });
    await audit(tx, { ...auditBase(ctx, t.taxpayerId), action: "bank.classify", resourceType: "bank_transaction", resourceId: t.id, details: { account: account.code, entryNo: entry.entryNo, rule: data.saveKeyword ?? rule?.keyword ?? null } });
    return { entryId: entry.id, entryNo: entry.entryNo };
  });
}

/** Yok say / geri al (ör. başka yerde işlenen virman). Fiş oluşmaz. */
export async function setIgnored(ctx: RequestContext, transactionId: string, ignored: boolean) {
  assertPermission(ctx, "bank:import");
  return withTenant(tenantScope(ctx), async (tx) => {
    const t = await getAccessibleTransaction(tx, ctx, transactionId);
    if (t.status === "MATCHED") throw new AppError("CONFLICT", "Fişe bağlanmış hareket yok sayılamaz; önce fişi ters kayıtla iptal edin");
    await tx.bankTransaction.update({ where: { id: t.id }, data: { status: ignored ? "IGNORED" : "UNMATCHED", matchedBy: ignored ? ctx.userId : null, matchedAt: ignored ? new Date() : null } });
    await audit(tx, { ...auditBase(ctx, t.taxpayerId), action: ignored ? "bank.ignore" : "bank.unignore", resourceType: "bank_transaction", resourceId: t.id });
    return { id: t.id, status: ignored ? "IGNORED" : "UNMATCHED" };
  });
}

export async function setBankRuleActive(ctx: RequestContext, ruleId: string, isActive: boolean) {
  assertPermission(ctx, "bank:manage");
  return withTenant(tenantScope(ctx), async (tx) => {
    const parsed = z.uuid().safeParse(ruleId);
    const rule = parsed.success ? await tx.bankRule.findFirst({ where: { id: parsed.data, organizationId: ctx.organizationId, taxpayer: taxpayerVisibility(ctx) } }) : null;
    if (!rule) throw notFound("Kural");
    await tx.bankRule.update({ where: { id: rule.id }, data: { isActive } });
    await audit(tx, { ...auditBase(ctx, rule.taxpayerId), action: isActive ? "bank.rule_enable" : "bank.rule_disable", resourceType: "bank_rule", resourceId: rule.id });
    return { id: rule.id, isActive };
  });
}

export type BankSuggestion = Suggestion;
