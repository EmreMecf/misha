import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { StatementImport } from "@/components/bank/StatementImport";
import { TransactionList, type SuggestionView } from "@/components/bank/TransactionList";
import { formatMoney } from "@/components/documents/format";
import { Badge, Card, CardHeader, cx, EmptyState, formatDate, PageHeader } from "@/components/ui/primitives";
import { getBankAccountDetail, transactionQuerySchema } from "@/server/bank/bankService";
import { AppError } from "@/server/errors";
import { getPageContext } from "@/server/tenancy/pageContext";
import { can } from "@/server/tenancy/permissions";

export const metadata = { title: "Banka hesabı" };

const CHECK = { OK: { label: "Bakiye tutuyor", tone: "good" }, MISMATCH: { label: "Bakiye tutmuyor", tone: "critical" }, NO_BALANCE: { label: "Bakiye yok", tone: "neutral" } } as const;
const FILTERS = [
  { status: "UNMATCHED", label: "Bekleyen" },
  { status: undefined, label: "Tümü" },
  { status: "MATCHED", label: "Eşleşen" },
  { status: "IGNORED", label: "Yok sayılan" },
] as const;

export default function BankAccountPage({ params, searchParams }: PageProps<"/mukellefler/[id]/banka/[accountId]">) {
  return (
    <Suspense fallback={<div className="h-64 animate-pulse rounded-xl bg-surface-2" />}>
      <Detail params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Detail({ params, searchParams }: { params: Promise<{ id: string; accountId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await connection();
  const ctx = await getPageContext();
  const { id, accountId } = await params;
  const sp = await searchParams;
  // Varsayılan görünüm: bekleyen hareketler
  const rawStatus = typeof sp.durum === "string" ? sp.durum : "UNMATCHED";
  const parsed = transactionQuerySchema.safeParse({ status: rawStatus === "TUMU" ? undefined : rawStatus });
  const status = parsed.success ? parsed.data.status : "UNMATCHED";

  let data;
  try {
    data = await getBankAccountDetail(ctx, accountId, { status });
  } catch (error) {
    if (error instanceof AppError && (error.code === "NOT_FOUND" || error.code === "FORBIDDEN")) notFound();
    throw error;
  }
  if (data.account.taxpayer.id !== id) notFound();
  const base = `/mukellefler/${id}/banka/${accountId}`;
  const total = Object.values(data.counts).reduce((s, n) => s + (n ?? 0), 0);

  return (
    <div className="space-y-6">
      <Link href={`/mukellefler/${id}/banka`} className="text-xs font-medium text-ink-3 hover:text-ink">
        ← {data.account.taxpayer.title} · Banka
      </Link>
      <PageHeader
        title={data.account.name}
        description={[data.account.bankName, data.account.iban, `${data.account.ledgerAccount.code} ${data.account.ledgerAccount.name}`].filter(Boolean).join(" · ")}
      />

      {can(ctx.role, "bank:import") && (
        <Card>
          <CardHeader title="Ekstre aktar" description="Sütunlar başlıktan tahmin edilir; önizlemede düzeltebilirsiniz. Aynı hareket iki kez aktarılmaz." />
          <StatementImport accountId={accountId} />
        </Card>
      )}

      <Card>
        <CardHeader title="Hareketler" description="Öneriler gerekçesiyle gösterilir; onaylamadan fiş oluşmaz." />
        <nav aria-label="Duruma göre süz" className="flex flex-wrap gap-1.5 border-b border-line px-5 py-3">
          {FILTERS.map((f) => {
            const active = status === f.status;
            const count = f.status ? (data.counts[f.status] ?? 0) : total;
            return (
              <Link
                key={f.label}
                href={f.status === "UNMATCHED" ? base : `${base}?durum=${f.status ?? "TUMU"}`}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "rounded-full border px-3 py-1 text-xs transition",
                  active ? "border-brand bg-brand-soft font-medium text-brand-ink" : "border-line text-ink-2 hover:bg-surface-2",
                )}
              >
                {f.label} <span className="font-mono text-ink-3">{count}</span>
              </Link>
            );
          })}
        </nav>
        <TransactionList
          canPost={can(ctx.role, "journal:post")}
          canImport={can(ctx.role, "bank:import")}
          accounts={data.accounts.filter((a) => a.id !== data.account.ledgerAccountId)}
          transactions={data.transactions.map((t) => ({
            id: t.id,
            txDate: t.txDate.toISOString().slice(0, 10),
            description: t.description,
            reference: t.reference,
            amount: t.amount.toFixed(2),
            balance: t.balance?.toFixed(2) ?? null,
            status: t.status,
            matchReason: t.matchReason,
            entryNo: t.journalEntry?.entryNo ?? null,
            matchedDocument: t.matchedDocument ? { id: t.matchedDocument.id, label: t.matchedDocument.documentNo ?? "Fatura" } : null,
            suggestion: t.suggestion as SuggestionView | null,
          }))}
        />
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="self-start">
          <CardHeader title="Aktarılan ekstreler" />
          {data.statements.length === 0 ? (
            <EmptyState title="Ekstre yok" />
          ) : (
            <ul className="divide-y divide-line">
              {data.statements.map((s) => (
                <li key={s.id} className="px-5 py-2.5 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-ink">
                      {formatDate(s.periodStart)} – {formatDate(s.periodEnd)}
                    </span>
                    <Badge tone={CHECK[s.balanceCheck].tone}>{CHECK[s.balanceCheck].label}</Badge>
                  </div>
                  <p className="mt-0.5 text-xs text-ink-3">
                    {s.fileName} · {s.importedCount} aktarıldı{s.duplicateCount > 0 ? `, ${s.duplicateCount} mükerrer` : ""}
                    {s.closingBalance ? ` · kapanış ${formatMoney(s.closingBalance)}` : ""}
                  </p>
                  {Array.isArray(s.findings) &&
                    (s.findings as Array<{ code: string; message: string }>)
                      .filter((f) => f.code !== "DUPLICATES_SKIPPED")
                      .map((f) => (
                        <p key={f.code} className="mt-0.5 text-xs text-ink-2">
                          {f.message}
                        </p>
                      ))}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="self-start">
          <CardHeader title="Banka kuralları" description="Hesaba işlerken kaydedilen anahtar kelimeler. Yalnız bu mükellefe uygulanır." />
          {data.rules.length === 0 ? (
            <EmptyState title="Kural yok" />
          ) : (
            <ul className="divide-y divide-line">
              {data.rules.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-2 px-5 py-2 text-sm">
                  <span className={cx("font-mono text-xs", r.isActive ? "text-ink" : "text-ink-3 line-through")}>&quot;{r.keyword}&quot;</span>
                  <span className="text-xs text-ink-3">{r.direction === "IN" ? "giriş" : r.direction === "OUT" ? "çıkış" : "her iki yön"} →</span>
                  <span className="font-mono text-xs text-ink-2">
                    {r.account.code} {r.account.name}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
