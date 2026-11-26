import type { DocumentStatus } from "@prisma/client";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { AutoRefresh } from "@/components/documents/AutoRefresh";
import { DocumentUpload } from "@/components/documents/DocumentUpload";
import { formatMoney } from "@/components/documents/format";
import { Badge, Card, CardHeader, cx, EmptyState, formatDate, formatDateTime, PageHeader } from "@/components/ui/primitives";
import { DIRECTION_LABELS, FORMAT_LABELS, PROCESSING_STATUSES, STATUS_LABELS, STATUS_TONES } from "@/lib/documentLabels";
import { listDocuments, listQuerySchema } from "@/server/documents/documentService";
import { AppError } from "@/server/errors";
import { getPageContext } from "@/server/tenancy/pageContext";
import { can } from "@/server/tenancy/permissions";
import { getTaxpayer } from "@/server/taxpayers/taxpayerService";

export const metadata = { title: "Belgeler" };

// Süzgeç çubuğu: kullanıcının iş akışı sırasıyla
const FILTERS: Array<{ status?: DocumentStatus; label: string }> = [
  { label: "Tümü" },
  { status: "NEEDS_REVIEW", label: STATUS_LABELS.NEEDS_REVIEW },
  { status: "VALIDATION_REQUIRED", label: STATUS_LABELS.VALIDATION_REQUIRED },
  { status: "ACCOUNTING_PENDING", label: STATUS_LABELS.ACCOUNTING_PENDING },
  { status: "DUPLICATE", label: STATUS_LABELS.DUPLICATE },
  { status: "REJECTED", label: STATUS_LABELS.REJECTED },
  { status: "FAILED", label: STATUS_LABELS.FAILED },
];

const SHOW_REASON: readonly DocumentStatus[] = ["VALIDATION_REQUIRED", "REJECTED", "FAILED", "DUPLICATE"];

export default function DocumentsPage({ params, searchParams }: PageProps<"/mukellefler/[id]/belgeler">) {
  return (
    <Suspense fallback={<div className="h-64 animate-pulse rounded-xl bg-surface-2" />}>
      <Documents params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Documents({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await connection();
  const ctx = await getPageContext();
  const { id } = await params;
  const sp = await searchParams;
  const parsed = listQuerySchema.safeParse({
    status: typeof sp.durum === "string" ? sp.durum : undefined,
    cursor: typeof sp.sonraki === "string" ? sp.sonraki : undefined,
  });
  const query = parsed.success ? parsed.data : { limit: 50 as const, status: undefined };

  let taxpayer, list;
  try {
    [taxpayer, list] = await Promise.all([getTaxpayer(ctx, id), listDocuments(ctx, id, query)]);
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  const total = Object.values(list.counts).reduce((s, n) => s + (n ?? 0), 0);
  const processing = list.items.some((d) => PROCESSING_STATUSES.includes(d.status));
  const base = `/mukellefler/${taxpayer.id}/belgeler`;

  return (
    <div className="space-y-6">
      <Link href={`/mukellefler/${taxpayer.id}`} className="text-xs font-medium text-ink-3 hover:text-ink">
        ← {taxpayer.title}
      </Link>
      <PageHeader title="Belgeler" description={`${taxpayer.title} · ${total} belge`} />

      {can(ctx.role, "document:upload") && (
        <Card>
          <DocumentUpload taxpayerId={taxpayer.id} />
        </Card>
      )}

      <Card>
        <CardHeader title="Belge listesi" description="e-Fatura / e-Arşiv XML otomatik okunur; PDF ve görseller şimdilik elle işlenir." />
        <nav aria-label="Duruma göre süz" className="flex gap-1.5 overflow-x-auto border-b border-line px-5 py-3">
          {FILTERS.map((f) => {
            const active = query.status === f.status;
            const count = f.status ? (list.counts[f.status] ?? 0) : total;
            return (
              <Link
                key={f.label}
                href={f.status ? `${base}?durum=${f.status}` : base}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "shrink-0 whitespace-nowrap rounded-full border px-3 py-1 text-xs transition",
                  active ? "border-brand bg-brand-soft font-medium text-brand-ink" : "border-line text-ink-2 hover:bg-surface-2",
                )}
              >
                {f.label} <span className="font-mono text-ink-3">{count}</span>
              </Link>
            );
          })}
        </nav>
        {processing && <AutoRefresh />}
        {list.items.length === 0 ? (
          <EmptyState
            title="Belge yok"
            description={query.status ? "Bu durumda belge bulunmuyor." : "Yukarıdan e-Fatura XML, ZIP veya PDF yükleyin."}
          />
        ) : (
          <ul className="divide-y divide-line">
            {list.items.map((d) => (
              <li key={d.id}>
                <Link
                  href={`/belgeler/${d.id}`}
                  className="grid gap-x-4 gap-y-1 px-5 py-3 text-sm transition hover:bg-surface-2 sm:grid-cols-[minmax(0,1fr)_auto]"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="min-w-0 truncate font-medium text-ink">{d.counterpartyName ?? d.originalName}</span>
                      {d.direction && <Badge>{DIRECTION_LABELS[d.direction]}</Badge>}
                      <Badge tone={STATUS_TONES[d.status]}>{STATUS_LABELS[d.status]}</Badge>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-ink-3">
                      {[FORMAT_LABELS[d.format], d.documentNo, d.documentDate ? formatDate(d.documentDate) : null, d.counterpartyName ? d.originalName : null]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    {d.statusReason && SHOW_REASON.includes(d.status) && <p className="mt-0.5 line-clamp-2 text-xs text-ink-2">{d.statusReason}</p>}
                  </div>
                  <div className="flex items-baseline gap-3 sm:flex-col sm:items-end sm:gap-0.5">
                    <span className="font-mono text-sm tabular-nums text-ink">{formatMoney(d.payableAmount, d.currency)}</span>
                    <span className="text-xs text-ink-3">{formatDateTime(d.createdAt)}</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {list.nextCursor && (
          <div className="border-t border-line px-5 py-3 text-right">
            <Link
              className="text-xs font-medium text-brand-ink hover:underline"
              href={`${base}?${new URLSearchParams({ ...(query.status ? { durum: query.status } : {}), sonraki: list.nextCursor })}`}
            >
              Sonraki sayfa →
            </Link>
          </div>
        )}
      </Card>
    </div>
  );
}
