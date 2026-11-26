import type { DocumentStatus } from "@prisma/client";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { AutoRefresh } from "@/components/documents/AutoRefresh";
import { DocumentActions } from "@/components/documents/DocumentActions";
import { formatMoney, formatQuantity, formatRate } from "@/components/documents/format";
import { Alert, Badge, Card, CardHeader, EmptyState, formatDate, formatDateTime, PageHeader } from "@/components/ui/primitives";
import { DIRECTION_LABELS, FIELD_LABELS, FORMAT_LABELS, PROCESSING_STATUSES, STATUS_LABELS, STATUS_TONES, unitLabel } from "@/lib/documentLabels";
import { JournalPanel } from "@/components/ledger/JournalPanel";
import { toEntryView } from "@/components/ledger/journalView";
import { getDocument } from "@/server/documents/documentService";
import { getDocumentJournal } from "@/server/ledger/journalService";
import { AppError } from "@/server/errors";
import { getPageContext } from "@/server/tenancy/pageContext";
import { can } from "@/server/tenancy/permissions";

export const metadata = { title: "Belge" };

interface FieldInfo {
  value: string | null;
  source: string;
  method: string;
  confidence: number;
}
interface Finding {
  code: string;
  message: string;
}

const REPROCESSABLE: readonly DocumentStatus[] = ["VALIDATION_REQUIRED", "NEEDS_REVIEW", "FAILED", "REJECTED"];
const REJECTABLE: readonly DocumentStatus[] = ["VALIDATION_REQUIRED", "NEEDS_REVIEW", "ACCOUNTING_PENDING", "FAILED"];
const JOURNAL_STATUSES: readonly DocumentStatus[] = ["ACCOUNTING_PENDING", "APPROVED", "EXPORT_PENDING", "EXPORTING", "EXPORTED"];
const ALERT_STATUSES: readonly DocumentStatus[] = ["VALIDATION_REQUIRED", "REJECTED", "FAILED", "DUPLICATE"];
const MONEY_FIELDS = new Set(["lineExtension", "taxExclusive", "taxInclusive", "payable"]);

/** JSONB anahtar sırasını korumaz: alanları etiket tablosundaki sırayla, bilinmeyenleri sonda göster. */
function orderedFields(fields: Record<string, FieldInfo>) {
  const known = Object.keys(FIELD_LABELS).filter((k) => k in fields);
  const rest = Object.keys(fields).filter((k) => !(k in FIELD_LABELS));
  return [...known, ...rest].map((k) => [k, fields[k]] as const);
}

const PREVIEWABLE = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp"]);

export default function DocumentPage({ params }: PageProps<"/belgeler/[id]">) {
  return (
    <Suspense fallback={<div className="h-64 animate-pulse rounded-xl bg-surface-2" />}>
      <DocumentDetail params={params} />
    </Suspense>
  );
}

async function DocumentDetail({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const ctx = await getPageContext();
  const { id } = await params;
  let doc;
  try {
    doc = await getDocument(ctx, id);
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const fields = (doc.extraction?.fields ?? {}) as unknown as Record<string, FieldInfo>;
  const validation = (doc.extraction?.validation ?? { errors: [], warnings: [] }) as unknown as { errors: Finding[]; warnings: Finding[] };
  const inv = doc.invoice;
  const canReview = can(ctx.role, "document:review");
  // Muhasebe fişi: kontrol edilmiş (veya sonrasındaki) faturalar için
  const journal = inv && can(ctx.role, "ledger:read") && JOURNAL_STATUSES.includes(doc.status) ? await getDocumentJournal(ctx, doc.id) : null;
  const fileUrl = `/api/v1/documents/${doc.id}/file`;
  const hasFile = Boolean(doc.storageKey || doc.duplicateOfId);

  return (
    <div className="space-y-6">
      <Link href={`/mukellefler/${doc.taxpayer.id}/belgeler`} className="text-xs font-medium text-ink-3 hover:text-ink">
        ← {doc.taxpayer.title} · Belgeler
      </Link>
      <PageHeader
        title={inv ? `${inv.invoiceNo}` : doc.originalName}
        description={[FORMAT_LABELS[doc.format], doc.direction ? DIRECTION_LABELS[doc.direction] : null, doc.documentDate ? formatDate(doc.documentDate) : null, doc.originalName]
          .filter(Boolean)
          .join(" · ")}
        action={<Badge tone={STATUS_TONES[doc.status]}>{STATUS_LABELS[doc.status]}</Badge>}
      />
      {PROCESSING_STATUSES.includes(doc.status) && (
        <Card>
          <AutoRefresh />
        </Card>
      )}
      {doc.statusReason && ALERT_STATUSES.includes(doc.status) && (
        <Alert tone={doc.status === "REJECTED" || doc.status === "FAILED" ? "critical" : "warning"}>{doc.statusReason}</Alert>
      )}
      {doc.duplicateOfId && (
        <p className="text-sm text-ink-2">
          Bu belge daha önce yüklenmiş.{" "}
          <Link href={`/belgeler/${doc.duplicateOfId}`} className="font-medium text-brand-ink hover:underline">
            Asıl belgeye git →
          </Link>
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        {/* Sol: belge önizleme */}
        <Card className="min-w-0 self-start">
          <CardHeader
            title="Belge"
            action={
              hasFile ? (
                <a href={fileUrl} className="text-xs font-medium text-brand-ink hover:underline" download={doc.originalName}>
                  Dosyayı indir
                </a>
              ) : undefined
            }
          />
          {hasFile && PREVIEWABLE.has(doc.mimeType) ? (
            doc.format === "PDF" ? (
              <iframe src={fileUrl} title={`${doc.originalName} önizleme`} className="h-[70vh] w-full rounded-b-xl bg-surface-2" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element -- yetkili API yanıtı, next/image optimizasyonu uygun değil
              <img src={fileUrl} alt={doc.originalName} className="mx-auto max-h-[70vh] w-auto p-4" />
            )
          ) : inv ? (
            <InvoicePreview inv={inv} />
          ) : (
            <EmptyState title="Önizleme yok" description="Bu dosya türü için önizleme yapılamıyor; dosyayı indirerek açabilirsiniz." />
          )}
        </Card>

        {/* Sağ: okunan alanlar, doğrulama, işlemler */}
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader
              title="Okunan alanlar"
              description={doc.extraction ? `${doc.extraction.parser} ${doc.extraction.parserVersion} · güven %${Math.round(Number(doc.extraction.confidence) * 100)}` : "Henüz alan okunmadı"}
            />
            {Object.keys(fields).length === 0 ? (
              <EmptyState title="Alan yok" description="XML dışındaki belgelerin otomatik okunması (OCR) sonraki fazda etkinleşecek." />
            ) : (
              <dl className="divide-y divide-line">
                {orderedFields(fields).map(([key, f]) => (
                  <div key={key} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-3 px-5 py-2 text-sm">
                    <dt className="text-xs text-ink-3" title={f.source}>
                      {FIELD_LABELS[key] ?? key}
                    </dt>
                    <dd className="min-w-0 break-words font-mono text-xs text-ink">
                      {f.value == null ? <span className="text-ink-3">—</span> : MONEY_FIELDS.has(key) ? formatMoney(f.value, fields.currency?.value) : f.value}
                      {f.confidence < 1 && <span className="ml-2 text-ink-3">(güven %{Math.round(f.confidence * 100)})</span>}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
            {Object.keys(fields).length > 0 && (
              <p className="border-t border-line px-5 py-2 text-[11px] text-ink-3">Kaynak: XML alanlarından doğrudan okundu. Alan adının üzerine gelince XML yolu görünür.</p>
            )}
          </Card>

          {(validation.errors.length > 0 || validation.warnings.length > 0) && (
            <Card>
              <CardHeader title="Doğrulama" description={`${validation.errors.length} hata · ${validation.warnings.length} uyarı`} />
              <ul className="divide-y divide-line">
                {validation.errors.map((e, i) => (
                  <li key={`e${i}`} className="flex items-start gap-2 px-5 py-2 text-sm">
                    <Badge tone="critical">Hata</Badge>
                    <span className="text-ink">{e.message}</span>
                  </li>
                ))}
                {validation.warnings.map((w, i) => (
                  <li key={`w${i}`} className="flex items-start gap-2 px-5 py-2 text-sm">
                    <Badge tone="warning">Uyarı</Badge>
                    <span className="text-ink">{w.message}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {canReview && (
            <Card className="p-5">
              <DocumentActions
                documentId={doc.id}
                canReview={doc.status === "NEEDS_REVIEW"}
                canReprocess={REPROCESSABLE.includes(doc.status) && Boolean(doc.storageKey)}
                canReject={REJECTABLE.includes(doc.status)}
              />
            </Card>
          )}

          <Card>
            <CardHeader title="Durum geçmişi" />
            <ol className="divide-y divide-line">
              {doc.events.map((e) => (
                <li key={e.id} className="px-5 py-2 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-ink">{STATUS_LABELS[e.toStatus]}</span>
                    <span className="text-xs text-ink-3">{formatDateTime(e.createdAt)}</span>
                    <span className="text-xs text-ink-3">{e.actorUserId ? "kullanıcı" : "sistem"}</span>
                  </div>
                  {e.reason && <p className="mt-0.5 text-xs text-ink-2">{e.reason}</p>}
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>

      {journal && (
        <Card>
          <JournalPanel
            documentId={doc.id}
            taxpayerId={journal.taxpayerId}
            documentStatus={journal.documentStatus}
            entries={journal.entries.map(toEntryView)}
            accounts={journal.accounts}
            hasChart={journal.hasChart}
            canEdit={can(ctx.role, "journal:edit")}
            canPost={can(ctx.role, "journal:post")}
            canManageChart={can(ctx.role, "ledger:manage")}
          />
        </Card>
      )}

      {inv && (
        <Card>
          <CardHeader title="Kalemler" description={`${inv.lines.length} kalem`} />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="text-left text-xs text-ink-3">
                <tr className="border-b border-line">
                  <th className="px-5 py-2 font-medium">#</th>
                  <th className="px-2 py-2 font-medium">Açıklama</th>
                  <th className="px-2 py-2 font-medium">Stok kodu</th>
                  <th className="px-2 py-2 text-right font-medium">Miktar</th>
                  <th className="px-2 py-2 text-right font-medium">Birim fiyat</th>
                  <th className="px-2 py-2 text-right font-medium">Tutar</th>
                  <th className="px-2 py-2 text-right font-medium">KDV</th>
                  <th className="px-5 py-2 text-right font-medium">KDV tutarı</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line font-mono text-xs tabular-nums">
                {inv.lines.map((l) => (
                  <tr key={l.id}>
                    <td className="px-5 py-2 text-ink-3">{l.lineNo}</td>
                    <td className="px-2 py-2 font-sans text-sm text-ink">{l.name}</td>
                    <td className="px-2 py-2 text-ink-2">{l.stockCode ?? "—"}</td>
                    <td className="px-2 py-2 text-right">
                      {formatQuantity(l.quantity)} {unitLabel(l.unitCode)}
                    </td>
                    <td className="px-2 py-2 text-right">{l.unitPrice ? formatMoney(l.unitPrice) : "—"}</td>
                    <td className="px-2 py-2 text-right">{formatMoney(l.lineAmount)}</td>
                    <td className="px-2 py-2 text-right">{formatRate(l.vatRate)}</td>
                    <td className="px-5 py-2 text-right">{formatMoney(l.vatAmount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {inv.taxes.length > 0 && (
            <div className="border-t border-line px-5 py-3">
              <h3 className="mb-2 text-xs font-semibold text-ink-2">Vergiler</h3>
              <ul className="space-y-1 font-mono text-xs tabular-nums">
                {inv.taxes.map((t) => (
                  <li key={t.id} className="flex flex-wrap justify-between gap-2">
                    <span className="font-sans text-ink">
                      {t.taxName} {formatRate(t.rate)}
                      {t.isWithholding && " (tevkifat)"}
                    </span>
                    <span>
                      matrah {formatMoney(t.taxableAmount)} · vergi {formatMoney(t.taxAmount)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

/** XML fatura için okunan veriden güvenli önizleme (gömülü XSLT çalıştırılmaz). */
function InvoicePreview({ inv }: { inv: NonNullable<Awaited<ReturnType<typeof getDocument>>["invoice"]> }) {
  const row = (label: string, value: string, strong = false) => (
    <div className="flex justify-between gap-4 py-1">
      <span className="text-ink-2">{label}</span>
      <span className={strong ? "font-mono font-semibold tabular-nums text-ink" : "font-mono tabular-nums text-ink"}>{value}</span>
    </div>
  );
  return (
    <div className="space-y-5 p-5 text-sm">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg bg-surface-2 p-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-ink-3">Satıcı</p>
          <p className="mt-1 font-medium text-ink">{inv.supplierName ?? "—"}</p>
          <p className="font-mono text-xs text-ink-2">{inv.supplierTaxId ?? "—"}</p>
        </div>
        <div className="rounded-lg bg-surface-2 p-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-ink-3">Alıcı</p>
          <p className="mt-1 font-medium text-ink">{inv.customerName ?? "—"}</p>
          <p className="font-mono text-xs text-ink-2">{inv.customerTaxId ?? "—"}</p>
        </div>
      </div>
      <div className="grid gap-1 text-xs sm:grid-cols-2">
        <p>
          <span className="text-ink-3">Tarih:</span> {formatDate(inv.issueDate)}
        </p>
        <p>
          <span className="text-ink-3">Senaryo / tip:</span> {inv.profileId} / {inv.invoiceTypeCode}
        </p>
        <p className="break-all sm:col-span-2">
          <span className="text-ink-3">ETTN:</span> <span className="font-mono">{inv.ettn}</span>
        </p>
      </div>
      <div className="ml-auto max-w-xs border-t border-line pt-2">
        {row("Mal/hizmet toplamı", formatMoney(inv.lineExtensionAmount, inv.currency))}
        {row("Vergiler dahil", formatMoney(inv.taxInclusiveAmount, inv.currency))}
        {inv.withholdingTotal.greaterThan(0) && row("Tevkifat", `-${formatMoney(inv.withholdingTotal, inv.currency)}`)}
        {row("Ödenecek", formatMoney(inv.payableAmount, inv.currency), true)}
      </div>
    </div>
  );
}
