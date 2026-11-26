import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { auditLabel } from "@/components/audit/auditLabels";
import { Card, CardHeader, EmptyState, formatDateTime, PageHeader } from "@/components/ui/primitives";
import { getOverview } from "@/server/dashboard/overviewService";
import { getPageContext } from "@/server/tenancy/pageContext";
import { can } from "@/server/tenancy/permissions";

export const metadata = { title: "Genel Bakış" };

export default function OverviewPage() {
  return (
    <Suspense fallback={<div className="h-64 animate-pulse rounded-xl bg-surface-2" />}>
      <Overview />
    </Suspense>
  );
}

function Stat({ label, value, hint, href }: { label: string; value: number; hint?: string; href?: string }) {
  const body = (
    <>
      <p className="text-xs font-medium text-ink-2">{label}</p>
      <p className="mt-2 font-mono text-3xl font-medium tabular-nums text-ink">{value.toLocaleString("tr-TR")}</p>
      {hint && <p className="mt-1 text-xs text-ink-3">{hint}</p>}
    </>
  );
  return href ? (
    <Link href={href} className="rounded-xl border border-line bg-surface p-4 transition hover:border-line-strong">
      {body}
    </Link>
  ) : (
    <div className="rounded-xl border border-line bg-surface p-4">{body}</div>
  );
}

async function Overview() {
  await connection();
  const ctx = await getPageContext();
  const data = await getOverview(ctx);
  const firstName = ctx.fullName.split(" ")[0];

  return (
    <div className="space-y-6">
      <PageHeader title={`Merhaba ${firstName}`} description="Ofisinizin güncel durumu. Belge işleme modülleri sonraki fazlarda bu ekrana eklenecek." />

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Aktif mükellef" value={data.activeTaxpayers} href="/mukellefler" hint={data.archivedTaxpayers ? `${data.archivedTaxpayers} arşivde` : undefined} />
        <Stat label="Güncel dönemi olmayan" value={data.withoutCurrentPeriod.length} hint="Bugünü kapsayan açık mali dönem yok" />
        {data.members !== null && <Stat label="Aktif personel" value={data.members} href="/personel" />}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Dikkat gerektirenler" description="Bugünü kapsayan açık mali dönemi olmayan mükellefler" />
          {data.withoutCurrentPeriod.length === 0 ? (
            <EmptyState title="Her mükellefin güncel dönemi açık" />
          ) : (
            <ul className="divide-y divide-line">
              {data.withoutCurrentPeriod.map((t) => (
                <li key={t.id}>
                  <Link href={`/mukellefler/${t.id}`} className="flex items-center justify-between px-5 py-2.5 text-sm hover:bg-surface-2/60">
                    <span className="truncate text-ink">{t.title}</span>
                    <span className="shrink-0 text-xs font-medium text-brand">Dönem aç →</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {data.recent && (
          <Card>
            <CardHeader
              title="Son işlemler"
              action={can(ctx.role, "audit:read") ? <Link href="/islem-gecmisi" className="text-xs font-medium text-brand">Tümü →</Link> : undefined}
            />
            {data.recent.length === 0 ? (
              <EmptyState title="Henüz işlem yok" />
            ) : (
              <ul className="divide-y divide-line">
                {data.recent.map((log) => (
                  <li key={log.id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                    <span className="truncate text-ink">{auditLabel(log.action)}</span>
                    <span className="shrink-0 font-mono text-xs text-ink-3">{formatDateTime(log.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}
