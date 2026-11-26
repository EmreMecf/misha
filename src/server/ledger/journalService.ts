import { Prisma, type AccountRole, type InvoiceDirection, type JournalEntryStatus } from "@prisma/client";
import Decimal from "decimal.js";
import { z } from "zod";
import { audit } from "@/server/audit/auditService";
import { getAccessibleDocument } from "@/server/documents/documentAccess";
import { transition } from "@/server/documents/stateMachine";
import { AppError, notFound } from "@/server/errors";
import { assertPermission, tenantScope, type RequestContext } from "@/server/tenancy/context";
import { withTenant, type Tx } from "@/server/tenancy/tenantDb";
import { getAccessibleTaxpayer, taxpayerVisibility } from "@/server/taxpayers/taxpayerService";
import { proposeEntry, type AccountRef, type Finding } from "./proposalEngine";

/**
 * Fiş yaşam döngüsü: öneri (DRAFT) → kullanıcı düzeltir → kesinleştir (POSTED, yevmiye no) →
 * gerekirse ters kayıtla iptal (REVERSED + yeni POSTED ters fiş). Kesinleşmiş fiş değiştirilemez;
 * denge, boş hesap ve açık dönem kuralları ayrıca veritabanı tetikleyicisiyle zorunludur.
 */

const accountRef = (a: { id: string; code: string; name: string }): AccountRef => ({ id: a.id, code: a.code, name: a.name });

type ProposeOutcome = { entryId: string } | { skipped: string };

/**
 * Belge için fiş önerisi üretir (varsa eski taslağı değiştirir). Belge "muhasebeleşmeyi bekliyor"
 * durumunda olmalı. Hesap planı / fatura / dönem yoksa hata atmaz, nedenini döner.
 */
export async function proposeForDocumentInTx(tx: Tx, ctx: RequestContext, documentId: string): Promise<ProposeOutcome> {
  const doc = await getAccessibleDocument(tx, ctx, documentId);
  if (doc.status !== "ACCOUNTING_PENDING") return { skipped: "Belge muhasebeleşmeyi beklemiyor" };
  if (!doc.fiscalPeriodId) return { skipped: "Belgenin mali dönemi yok" };
  const invoice = await tx.invoice.findUnique({ where: { documentId: doc.id }, include: { taxes: true } });
  if (!invoice) return { skipped: "Belgede okunmuş fatura yok" };
  if ((await tx.ledgerAccount.count({ where: { taxpayerId: doc.taxpayerId } })) === 0) {
    return { skipped: "Mükellefin hesap planı yok; önce hesap planını başlatın" };
  }

  const counterpartyTaxId = invoice.direction === "PURCHASE" ? invoice.supplierTaxId : invoice.customerTaxId;
  const counterpartyName = invoice.direction === "PURCHASE" ? invoice.supplierName : invoice.customerName;

  const [mappings, rule, history] = await Promise.all([
    tx.accountRoleMapping.findMany({ where: { taxpayerId: doc.taxpayerId }, include: { account: true } }),
    counterpartyTaxId
      ? tx.postingRule.findFirst({
          where: { taxpayerId: doc.taxpayerId, counterpartyTaxId, direction: invoice.direction, isActive: true, account: { isActive: true, isPostable: true } },
          include: { account: true },
        })
      : null,
    counterpartyTaxId ? mainAccountHistory(tx, doc.taxpayerId, counterpartyTaxId, invoice.direction) : null,
  ]);
  const roles: Partial<Record<AccountRole, AccountRef>> = {};
  for (const m of mappings) if (m.account.isActive && m.account.isPostable) roles[m.role] = accountRef(m.account);

  const proposal = proposeEntry(
    {
      direction: invoice.direction,
      invoiceTypeCode: invoice.invoiceTypeCode,
      invoiceNo: invoice.invoiceNo,
      currency: invoice.currency,
      exchangeRate: invoice.exchangeRate ? new Decimal(invoice.exchangeRate.toString()) : null,
      taxExclusiveAmount: new Decimal(invoice.taxExclusiveAmount.toString()),
      withholdingTotal: new Decimal(invoice.withholdingTotal.toString()),
      payableAmount: new Decimal(invoice.payableAmount.toString()),
      taxes: invoice.taxes.map((t) => ({
        taxTypeCode: t.taxTypeCode,
        taxName: t.taxName,
        rate: t.rate ? new Decimal(t.rate.toString()) : null,
        taxAmount: new Decimal(t.taxAmount.toString()),
        isWithholding: t.isWithholding,
      })),
      counterpartyTaxId,
      counterpartyName,
    },
    { roles, rule: rule ? accountRef(rule.account) : null, history },
  );

  // Eski taslak (yeniden öneri) silinir; kesinleşmiş fiş varsa yeni öneri yapılmaz
  const existing = await tx.journalEntry.findFirst({ where: { documentId: doc.id, reversalOfId: null, status: { not: "REVERSED" } } });
  if (existing?.status === "POSTED") return { skipped: "Belgenin kesinleşmiş fişi var" };
  if (existing) await tx.journalEntry.delete({ where: { id: existing.id } });

  const entry = await tx.journalEntry.create({
    data: {
      organizationId: doc.organizationId,
      taxpayerId: doc.taxpayerId,
      fiscalPeriodId: doc.fiscalPeriodId,
      documentId: doc.id,
      entryDate: invoice.issueDate,
      description: proposal.description,
      source: "RULE_ENGINE",
      direction: invoice.direction,
      counterpartyTaxId,
      counterpartyName,
      findings: proposal.findings as unknown as Prisma.InputJsonValue,
      createdBy: ctx.userId,
      lines: {
        create: proposal.lines.map((l, i) => ({
          organizationId: doc.organizationId,
          lineNo: i + 1,
          accountId: l.accountId,
          proposedAccountId: l.accountId,
          kind: l.kind,
          debit: l.debit.toFixed(2),
          credit: l.credit.toFixed(2),
          description: l.description,
          source: l.source,
          reason: l.reason,
        })),
      },
    },
  });
  return { entryId: entry.id };
}

/** Aynı karşı tarafın kesin (iptal edilmemiş) fişlerinde ana satırın en sık hesabı. */
async function mainAccountHistory(tx: Tx, taxpayerId: string, counterpartyTaxId: string, direction: InvoiceDirection) {
  const rows = await tx.journalEntryLine.groupBy({
    by: ["accountId"],
    where: {
      kind: "MAIN",
      accountId: { not: null },
      entry: { taxpayerId, counterpartyTaxId, direction, status: "POSTED", reversalOfId: null },
    },
    _count: { _all: true },
    orderBy: { _count: { accountId: "desc" } },
    take: 1,
  });
  const top = rows[0];
  if (!top?.accountId) return null;
  const account = await tx.ledgerAccount.findFirst({ where: { id: top.accountId, isActive: true, isPostable: true } });
  return account ? { account: accountRef(account), count: top._count._all } : null;
}

export async function proposeForDocument(ctx: RequestContext, documentId: string) {
  assertPermission(ctx, "journal:edit");
  return withTenant(tenantScope(ctx), async (tx) => {
    const result = await proposeForDocumentInTx(tx, ctx, documentId);
    if ("skipped" in result) throw new AppError("CONFLICT", result.skipped);
    const doc = await getAccessibleDocument(tx, ctx, documentId);
    await audit(tx, { organizationId: ctx.organizationId, actorUserId: ctx.userId, action: "journal.propose", resourceType: "journal_entry", resourceId: result.entryId, taxpayerId: doc.taxpayerId, ipAddress: ctx.ipAddress });
    return result;
  });
}

const entryInclude = {
  lines: { orderBy: { lineNo: "asc" }, include: { account: { select: { id: true, code: true, name: true } } } },
} satisfies Prisma.JournalEntryInclude;

/** Belgenin fişleri (güncel + iptal edilmiş + ters kayıtlar) ve seçilebilir hesaplar. */
export async function getDocumentJournal(ctx: RequestContext, documentId: string) {
  assertPermission(ctx, "ledger:read");
  return withTenant(tenantScope(ctx), async (tx) => {
    const doc = await getAccessibleDocument(tx, ctx, documentId);
    const [entries, accounts] = await Promise.all([
      tx.journalEntry.findMany({ where: { documentId: doc.id }, include: entryInclude, orderBy: { createdAt: "desc" } }),
      tx.ledgerAccount.findMany({ where: { taxpayerId: doc.taxpayerId, isActive: true, isPostable: true }, select: { id: true, code: true, name: true }, orderBy: { code: "asc" } }),
    ]);
    return { entries, accounts, hasChart: accounts.length > 0, taxpayerId: doc.taxpayerId, documentStatus: doc.status };
  });
}

async function getAccessibleEntry(tx: Tx, ctx: RequestContext, entryId: string) {
  const parsed = z.uuid().safeParse(entryId);
  if (!parsed.success) throw notFound("Fiş");
  const entry = await tx.journalEntry.findFirst({
    where: { id: parsed.data, organizationId: ctx.organizationId, taxpayer: taxpayerVisibility(ctx) },
    include: { lines: { orderBy: { lineNo: "asc" } } },
  });
  if (!entry) throw notFound("Fiş");
  return entry;
}

export const draftUpdateSchema = z.object({
  version: z.number().int().positive(),
  lines: z.array(z.object({ id: z.uuid(), accountId: z.uuid().nullable() })).min(1).max(200),
});

/** Taslak fişte satır hesaplarını değiştirir (tutarlar faturadan gelir, burada değişmez). */
export async function updateDraft(ctx: RequestContext, entryId: string, input: z.input<typeof draftUpdateSchema>) {
  assertPermission(ctx, "journal:edit");
  const data = draftUpdateSchema.parse(input);
  return withTenant(tenantScope(ctx), async (tx) => {
    const entry = await getAccessibleEntry(tx, ctx, entryId);
    if (entry.status !== "DRAFT") throw new AppError("CONFLICT", "Yalnızca taslak fiş düzenlenebilir");
    const byId = new Map(entry.lines.map((l) => [l.id, l]));
    for (const change of data.lines) {
      const line = byId.get(change.id);
      if (!line) throw new AppError("VALIDATION_ERROR", "Satır bu fişe ait değil");
      if (line.accountId === change.accountId) continue;
      if (change.accountId) {
        const account = await tx.ledgerAccount.findFirst({ where: { id: change.accountId, taxpayerId: entry.taxpayerId, isActive: true, isPostable: true } });
        if (!account) throw new AppError("VALIDATION_ERROR", "Hesap bu mükellefin hesap planında yok veya kayıt yapılamaz");
      }
      // "source" önerinin kaynağı olarak kalır; kullanıcı değişikliği accountId ≠ proposedAccountId ile anlaşılır
      await tx.journalEntryLine.update({ where: { id: line.id }, data: { accountId: change.accountId } });
    }
    // İyimser kilit: aynı anda başka biri düzenlediyse çakışma
    const { count } = await tx.journalEntry.updateMany({ where: { id: entry.id, version: data.version, status: "DRAFT" }, data: { version: { increment: 1 } } });
    if (count === 0) throw new AppError("CONFLICT", "Fiş bu arada değişti; sayfayı yenileyin");
    return { id: entry.id, version: data.version + 1 };
  });
}

export const postSchema = z.object({
  version: z.number().int().positive(),
  /** Ana satırda öneri değiştirildiyse bu karşı taraf için kesin kural oluştur */
  saveRule: z.boolean().default(false),
});

export async function nextEntryNo(tx: Tx, fiscalPeriodId: string) {
  // Dönem satırını kilitleyerek numaraları sıraya sok (eşzamanlı kesinleştirmede boşluk/çakışma olmaz)
  await tx.$queryRaw`SELECT id FROM fiscal_periods WHERE id = ${fiscalPeriodId}::uuid FOR UPDATE`;
  const last = await tx.journalEntry.aggregate({ where: { fiscalPeriodId }, _max: { entryNo: true } });
  return (last._max.entryNo ?? 0) + 1;
}

function assertPostable(lines: Array<{ accountId: string | null; debit: Prisma.Decimal; credit: Prisma.Decimal }>) {
  if (lines.length < 2) throw new AppError("CONFLICT", "Fişte en az iki satır olmalı");
  const missing = lines.filter((l) => !l.accountId).length;
  if (missing > 0) throw new AppError("CONFLICT", `${missing} satırın hesabı seçilmedi`);
  const d = lines.reduce((s, l) => s.plus(l.debit.toString()), new Decimal(0));
  const c = lines.reduce((s, l) => s.plus(l.credit.toString()), new Decimal(0));
  if (!d.eq(c) || d.isZero()) throw new AppError("CONFLICT", `Fiş dengesiz: borç ${d.toFixed(2)}, alacak ${c.toFixed(2)}`);
}

/** Kesinleştir: yevmiye numarası verilir, belge "onaylandı" olur, düzeltmeler öğrenme kaydına yazılır. */
export async function postEntry(ctx: RequestContext, entryId: string, input: z.input<typeof postSchema>) {
  assertPermission(ctx, "journal:post");
  const { version, saveRule } = postSchema.parse(input);
  return withTenant(tenantScope(ctx), async (tx) => {
    const entry = await getAccessibleEntry(tx, ctx, entryId);
    if (entry.status !== "DRAFT") throw new AppError("CONFLICT", "Fiş zaten kesinleşmiş");
    if (entry.version !== version) throw new AppError("CONFLICT", "Fiş bu arada değişti; sayfayı yenileyin");
    assertPostable(entry.lines);
    const period = await tx.fiscalPeriod.findUniqueOrThrow({ where: { id: entry.fiscalPeriodId } });
    if (period.status !== "OPEN") throw new AppError("CONFLICT", `${period.name} mali dönemi kapalı`);

    // Öğrenme: önerilen hesap değiştirildiyse kaydet; ana satır için istenirse kesin kural oluştur
    let ruleCreated = false;
    for (const line of entry.lines) {
      if (line.accountId === line.proposedAccountId || !line.accountId) continue;
      const makeRule = saveRule && line.kind === "MAIN" && !!entry.counterpartyTaxId && !!entry.direction;
      if (makeRule) {
        await tx.postingRule.upsert({
          where: { taxpayerId_counterpartyTaxId_direction: { taxpayerId: entry.taxpayerId, counterpartyTaxId: entry.counterpartyTaxId!, direction: entry.direction! } },
          create: {
            organizationId: entry.organizationId,
            taxpayerId: entry.taxpayerId,
            counterpartyTaxId: entry.counterpartyTaxId!,
            counterpartyName: entry.counterpartyName,
            direction: entry.direction!,
            accountId: line.accountId,
            createdBy: ctx.userId,
          },
          update: { accountId: line.accountId, isActive: true, counterpartyName: entry.counterpartyName },
        });
        ruleCreated = true;
      }
      await tx.accountCorrection.create({
        data: {
          organizationId: entry.organizationId,
          taxpayerId: entry.taxpayerId,
          entryId: entry.id,
          counterpartyTaxId: entry.counterpartyTaxId,
          direction: entry.direction,
          lineKind: line.kind,
          proposedAccountId: line.proposedAccountId,
          proposedSource: line.source,
          chosenAccountId: line.accountId,
          ruleCreated: makeRule,
          createdBy: ctx.userId,
        },
      });
    }

    const entryNo = await nextEntryNo(tx, entry.fiscalPeriodId);
    const { count } = await tx.journalEntry.updateMany({
      where: { id: entry.id, status: "DRAFT", version },
      data: { status: "POSTED", entryNo, postedBy: ctx.userId, postedAt: new Date(), version: { increment: 1 } },
    });
    if (count === 0) throw new AppError("CONFLICT", "Fiş bu arada değişti; sayfayı yenileyin");

    if (entry.documentId) {
      const doc = await tx.document.findUniqueOrThrow({ where: { id: entry.documentId } });
      if (doc.status === "ACCOUNTING_PENDING") {
        await transition(tx, doc, "APPROVED", { actor: { userId: ctx.userId }, reason: `Yevmiye ${entryNo} ile kesinleşti` });
      }
    }
    await audit(tx, {
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "journal.post",
      resourceType: "journal_entry",
      resourceId: entry.id,
      taxpayerId: entry.taxpayerId,
      details: { entryNo, period: period.name, ruleCreated },
      ipAddress: ctx.ipAddress,
    });
    return { id: entry.id, entryNo, ruleCreated };
  });
}

export const reverseSchema = z.object({ reason: z.string().trim().min(3, "İptal nedeni yazın").max(300) });

/**
 * Ters kayıt: kesin fişin borç/alacak yönleri değiştirilmiş kopyası aynı dönemde kesinleşir,
 * asıl fiş "iptal" olur. Belge yeniden "muhasebeleşmeyi bekliyor"a döner ve yeni öneri hazırlanır.
 */
export async function reverseEntry(ctx: RequestContext, entryId: string, input: z.input<typeof reverseSchema>) {
  assertPermission(ctx, "journal:post");
  const { reason } = reverseSchema.parse(input);
  return withTenant(tenantScope(ctx), async (tx) => {
    const entry = await getAccessibleEntry(tx, ctx, entryId);
    if (entry.status !== "POSTED") throw new AppError("CONFLICT", "Yalnızca kesinleşmiş fiş iptal edilebilir");
    if (entry.reversalOfId) throw new AppError("CONFLICT", "Ters kayıt iptal edilemez");
    const period = await tx.fiscalPeriod.findUniqueOrThrow({ where: { id: entry.fiscalPeriodId } });
    if (period.status !== "OPEN") throw new AppError("CONFLICT", `${period.name} mali dönemi kapalı; ters kayıt yapılamaz`);

    const reversal = await tx.journalEntry.create({
      data: {
        organizationId: entry.organizationId,
        taxpayerId: entry.taxpayerId,
        fiscalPeriodId: entry.fiscalPeriodId,
        documentId: entry.documentId,
        reversalOfId: entry.id,
        entryDate: entry.entryDate,
        description: `İPTAL (yevmiye ${entry.entryNo}): ${reason}`.slice(0, 500),
        source: "REVERSAL",
        direction: entry.direction,
        counterpartyTaxId: entry.counterpartyTaxId,
        counterpartyName: entry.counterpartyName,
        createdBy: ctx.userId,
        lines: {
          create: entry.lines.map((l) => ({
            organizationId: entry.organizationId,
            lineNo: l.lineNo,
            accountId: l.accountId,
            proposedAccountId: l.accountId,
            kind: l.kind,
            debit: l.credit,
            credit: l.debit,
            description: l.description,
            source: "USER",
            reason: `Yevmiye ${entry.entryNo} ters kaydı`,
          })),
        },
      },
    });
    const entryNo = await nextEntryNo(tx, entry.fiscalPeriodId);
    await tx.journalEntry.update({ where: { id: reversal.id }, data: { status: "POSTED", entryNo, postedBy: ctx.userId, postedAt: new Date() } });
    await tx.journalEntry.update({ where: { id: entry.id }, data: { status: "REVERSED" } });
    // Banka hareketinden oluşan fiş iptal edildiyse hareket yeniden eşleşme bekler
    await tx.bankTransaction.updateMany({
      where: { journalEntryId: entry.id },
      data: { status: "UNMATCHED", journalEntryId: null, matchedDocumentId: null, matchReason: null, matchedBy: null, matchedAt: null },
    });

    let proposal: ProposeOutcome | null = null;
    if (entry.documentId) {
      const doc = await tx.document.findUniqueOrThrow({ where: { id: entry.documentId } });
      if (doc.status === "APPROVED") {
        await transition(tx, doc, "ACCOUNTING_PENDING", { actor: { userId: ctx.userId }, reason: `Fiş iptal edildi: ${reason}` });
        proposal = await proposeForDocumentInTx(tx, ctx, doc.id);
      }
    }
    await audit(tx, {
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      action: "journal.reverse",
      resourceType: "journal_entry",
      resourceId: entry.id,
      taxpayerId: entry.taxpayerId,
      details: { entryNo: entry.entryNo, reversalNo: entryNo, reason },
      ipAddress: ctx.ipAddress,
    });
    return { reversalId: reversal.id, reversalNo: entryNo, newDraftId: proposal && "entryId" in proposal ? proposal.entryId : null };
  });
}

const STATUSES = ["DRAFT", "POSTED", "REVERSED"] as const satisfies readonly JournalEntryStatus[];
export const journalQuerySchema = z.object({
  status: z.enum(STATUSES).optional(),
  fiscalPeriodId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

/** Mükellefin yevmiye listesi (kesin fişler numara sırasıyla, taslaklar en sonda). */
export async function listJournal(ctx: RequestContext, taxpayerId: string, input: z.input<typeof journalQuerySchema> = {}) {
  assertPermission(ctx, "ledger:read");
  const q = journalQuerySchema.parse(input);
  return withTenant(tenantScope(ctx), async (tx) => {
    const taxpayer = await getAccessibleTaxpayer(tx, ctx, taxpayerId);
    const [entries, periods] = await Promise.all([
      tx.journalEntry.findMany({
        where: { taxpayerId: taxpayer.id, ...(q.status ? { status: q.status } : {}), ...(q.fiscalPeriodId ? { fiscalPeriodId: q.fiscalPeriodId } : {}) },
        include: entryInclude,
        orderBy: [{ entryNo: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
        take: q.limit,
      }),
      tx.fiscalPeriod.findMany({ where: { taxpayerId: taxpayer.id }, orderBy: { startDate: "desc" }, select: { id: true, name: true } }),
    ]);
    return { taxpayer: { id: taxpayer.id, title: taxpayer.title }, entries, periods };
  });
}

export type JournalFinding = Finding;

export interface PostedLineInput {
  accountId: string;
  kind: "BANK" | "COUNTERPARTY" | "MAIN";
  debit: Decimal;
  credit: Decimal;
  description: string;
  source: string;
  reason: string;
}

/**
 * Doğrudan kesin fiş oluşturur (taslak → satırlar → numara → POSTED). Banka mutabakatı gibi
 * kullanıcının tek tıkla onayladığı kayıtlar için. Denge ve dönem kuralları tetikleyicide de denetlenir.
 */
export async function createPostedEntry(
  tx: Tx,
  ctx: RequestContext,
  input: {
    taxpayerId: string;
    fiscalPeriodId: string;
    entryDate: Date;
    description: string;
    source: "BANK" | "MANUAL";
    direction?: InvoiceDirection | null;
    counterpartyTaxId?: string | null;
    counterpartyName?: string | null;
    documentId?: string | null;
    lines: PostedLineInput[];
  },
) {
  const entry = await tx.journalEntry.create({
    data: {
      organizationId: ctx.organizationId,
      taxpayerId: input.taxpayerId,
      fiscalPeriodId: input.fiscalPeriodId,
      entryDate: input.entryDate,
      description: input.description.slice(0, 500),
      source: input.source,
      direction: input.direction ?? null,
      counterpartyTaxId: input.counterpartyTaxId ?? null,
      counterpartyName: input.counterpartyName ?? null,
      createdBy: ctx.userId,
      lines: {
        create: input.lines.map((l, i) => ({
          organizationId: ctx.organizationId,
          lineNo: i + 1,
          accountId: l.accountId,
          proposedAccountId: l.accountId,
          kind: l.kind,
          debit: l.debit.toFixed(2),
          credit: l.credit.toFixed(2),
          description: l.description.slice(0, 300),
          source: l.source,
          reason: l.reason.slice(0, 500),
        })),
      },
    },
  });
  assertPostable(input.lines.map((l) => ({ accountId: l.accountId, debit: new Prisma.Decimal(l.debit.toFixed(2)), credit: new Prisma.Decimal(l.credit.toFixed(2)) })));
  const entryNo = await nextEntryNo(tx, input.fiscalPeriodId);
  await tx.journalEntry.update({ where: { id: entry.id }, data: { status: "POSTED", entryNo, postedBy: ctx.userId, postedAt: new Date() } });
  return { id: entry.id, entryNo };
}
