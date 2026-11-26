import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { NewTaxpayerDialog } from "@/components/taxpayers/TaxpayerForm";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { getPageContext } from "@/server/tenancy/pageContext";
import { can, SEES_ALL_TAXPAYERS } from "@/server/tenancy/permissions";
import { listTaxpayers } from "@/server/taxpayers/taxpayerService";

export const metadata = { title: "Mükellefler" };

const LEDGER_LABEL = { BILANCO: "Bilanço", ISLETME: "İşletme", SERBEST_MESLEK: "Serbest meslek" } as const;

export default function TaxpayersPage({ searchParams }: PageProps<"/mukellefler">) {
  return (
    <Suspense fallback={<div className="h-64 animate-pulse rounded-xl bg-surface-2" />}>
      <Taxpayers searchParams={searchParams} />
    </Suspense>
  );
}

async function Taxpayers({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await connection();
  const ctx = await getPageContext();
  const params = await searchParams;
  const search = typeof params.ara === "string" ? params.ara : undefined;
  const includeArchived = params.arsiv === "1";
  const taxpayers = await listTaxpayers(ctx, { search, includeArchived });
  const canCreate = can(ctx.role, "taxpayer:create");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Mükellefler"
        description={SEES_ALL_TAXPAYERS.has(ctx.role) ? "Ofisin tüm mükellefleri" : "Size atanmış mükellefler"}
        action={canCreate ? <NewTaxpayerDialog /> : undefined}
      />

      <form className="flex flex-wrap items-center gap-3" role="search">
        <input
          name="ara"
          defaultValue={search}
          placeholder="Unvan veya VKN/TCKN ara"
          aria-label="Mükellef ara"
          className="w-full max-w-xs rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand"
        />
        <label className="flex items-center gap-2 text-sm text-ink-2">
          <input type="checkbox" name="arsiv" value="1" defaultChecked={includeArchived} className="accent-[var(--brand)]" />
          Arşivdekileri göster
        </label>
        <button type="submit" className="rounded-lg border border-line bg-surface px-3 py-2 text-sm font-medium text-ink hover:bg-surface-2">
          Filtrele
        </button>
      </form>

      <Card>
        {taxpayers.length === 0 ? (
          <EmptyState
            title={search ? "Aramaya uyan mükellef yok" : "Henüz mükellef yok"}
            description={canCreate ? "İlk mükellefinizi ekleyin; ardından mali dönemini açın." : "Ofis yöneticiniz size mükellef atadığında burada görünür."}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[11px] font-medium uppercase tracking-wider text-ink-3">
                  <th className="px-5 py-2.5 font-medium">Unvan</th>
                  <th className="px-3 py-2.5 font-medium">VKN / TCKN</th>
                  <th className="px-3 py-2.5 font-medium">Defter</th>
                  <th className="px-3 py-2.5 text-right font-medium">Mali dönem</th>
                  <th className="px-5 py-2.5 font-medium">Durum</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {taxpayers.map((t) => (
                  <tr key={t.id} className="hover:bg-surface-2/50">
                    <td className="px-5 py-2.5">
                      <Link href={`/mukellefler/${t.id}`} className="font-medium text-ink hover:text-brand">
                        {t.title}
                      </Link>
                      {t.taxOffice && <span className="block text-xs text-ink-3">{t.taxOffice}</span>}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs text-ink-2">{t.taxId}</td>
                    <td className="px-3 py-2.5 text-ink-2">{LEDGER_LABEL[t.ledgerType]}</td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-ink-2">{t._count.fiscalPeriods}</td>
                    <td className="px-5 py-2.5">{t.status === "ACTIVE" ? <Badge tone="good">Aktif</Badge> : <Badge>Arşivde</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
