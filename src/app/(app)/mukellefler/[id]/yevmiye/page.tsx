import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { formatMoney } from "@/components/documents/format";
import { Badge, Card, CardHeader, cx, EmptyState, formatDate, PageHeader } from "@/components/ui/primitives";
import { AppError } from "@/server/errors";
import { journalQuerySchema, listJournal } from "@/server/ledger/journalService";
import { getPageContext } from "@/server/tenancy/pageContext";

export const metadata = { title: "Yevmiye" };

const STATUS = {
  DRAFT: { label: "Taslak", tone: "brand" },
  POSTED: { label: "Kesin", tone: "good" },
  REVERSED: { label: "İptal", tone: "critical" },
} as const;

export default function JournalPage({ params, searchParams }: PageProps<"/mukellefler/[id]/yevmiye">) {
  return (
    <Suspense fallback={<div className="h-64 animate-pulse rounded-xl bg-surface-2" />}>
      <Journal params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Journal({
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
  const parsed = journalQuerySchema.safeParse({
    status: typeof sp.durum === "string" ? sp.durum : undefined,
    fiscalPeriodId: typeof sp.donem === "string" ? sp.donem : undefined,
  });
  const query = parsed.success ? parsed.data : { limit: 100 };

  let data;
  try {
    data = await listJournal(ctx, id, query);
  } catch (error) {
    if (error instanceof AppError && (error.code === "NOT_FOUND" || error.code === "FORBIDDEN")) notFound();
    throw error;
  }
  const base = `/mukellefler/${data.taxpayer.id}/yevmiye`;
  const link = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const next = { durum: query.status, donem: query.fiscalPeriodId, ...over };
    for (const [k, v] of Object.entries(next)) if (v) p.set(k, v);
    return p.size ? `${base}?${p}` : base;
  };
  const chip = (active: boolean) =>
    cx(
      "shrink-0 whitespace-nowrap rounded-full border px-3 py-1 text-xs transition",
      active ? "border-brand bg-brand-soft font-medium text-brand-ink" : "border-line text-ink-2 hover:bg-surface-2",
    );

  return (
    <div className="space-y-6">
      <Link href={`/mukellefler/${data.taxpayer.id}`} className="text-xs font-medium text-ink-3 hover:text-ink">
        ← {data.taxpayer.title}
      </Link>
      <PageHeader title="Yevmiye" description={`${data.taxpayer.title} · ${data.entries.length} fiş`} />

      <Card>
        <CardHeader title="Fişler" description="Kesin fişler yevmiye numarası sırasıyla; taslaklar sonda." />
        <nav aria-label="Süz" className="flex flex-wrap gap-1.5 border-b border-line px-5 py-3">
          <Link href={link({ durum: undefined })} className={chip(!query.status)}>
            Tümü
          </Link>
          {(["POSTED", "DRAFT", "REVERSED"] as const).map((s) => (
            <Link key={s} href={link({ durum: s })} className={chip(query.status === s)}>
              {STATUS[s].label}
            </Link>
          ))}
          <span className="mx-1 w-px bg-line" aria-hidden="true" />
          {data.periods.map((p) => (
            <Link key={p.id} href={link({ donem: query.fiscalPeriodId === p.id ? undefined : p.id })} className={chip(query.fiscalPeriodId === p.id)}>
              {p.name}
            </Link>
          ))}
        </nav>
        {data.entries.length === 0 ? (
          <EmptyState title="Fiş yok" description="Belgeler kontrol edilip fişleri kesinleştirildikçe burada görünür." />
        ) : (
          <ol className="divide-y divide-line">
            {data.entries.map((e) => (
              <li key={e.id} className="px-5 py-3">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-mono font-semibold text-ink">{e.entryNo ?? "—"}</span>
                  <span className="text-xs text-ink-3">{formatDate(e.entryDate)}</span>
                  <Badge tone={STATUS[e.status].tone}>{e.reversalOfId ? "Ters kayıt" : STATUS[e.status].label}</Badge>
                  <span className="min-w-0 flex-1 truncate text-ink-2">{e.description}</span>
                  {e.documentId && (
                    <Link href={`/belgeler/${e.documentId}`} className="text-xs font-medium text-brand-ink hover:underline">
                      Belge →
                    </Link>
                  )}
                </div>
                <table className="mt-2 w-full text-xs">
                  <tbody className="font-mono tabular-nums">
                    {e.lines.map((l) => (
                      <tr key={l.id}>
                        <td className={cx("py-0.5 pr-2 text-ink", Number(l.credit) > 0 && "pl-6")}>{l.account ? `${l.account.code} ${l.account.name}` : "— hesap seçilmedi —"}</td>
                        <td className="w-32 py-0.5 text-right">{l.debit.gt(0) ? formatMoney(l.debit) : ""}</td>
                        <td className="w-32 py-0.5 text-right">{l.credit.gt(0) ? formatMoney(l.credit) : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}
