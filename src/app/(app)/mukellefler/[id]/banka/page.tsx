import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { BankAccountForm } from "@/components/bank/BankAccountForm";
import { formatMoney } from "@/components/documents/format";
import { Badge, Card, CardHeader, EmptyState, formatDate, PageHeader } from "@/components/ui/primitives";
import { listBankAccounts } from "@/server/bank/bankService";
import { AppError } from "@/server/errors";
import { getPageContext } from "@/server/tenancy/pageContext";
import { can } from "@/server/tenancy/permissions";

export const metadata = { title: "Banka" };

const CHECK = { OK: { label: "Bakiye tutuyor", tone: "good" }, MISMATCH: { label: "Bakiye tutmuyor", tone: "critical" }, NO_BALANCE: { label: "Bakiye yok", tone: "neutral" } } as const;

export default function BankPage({ params }: PageProps<"/mukellefler/[id]/banka">) {
  return (
    <Suspense fallback={<div className="h-64 animate-pulse rounded-xl bg-surface-2" />}>
      <Bank params={params} />
    </Suspense>
  );
}

async function Bank({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const ctx = await getPageContext();
  const { id } = await params;
  let data;
  try {
    data = await listBankAccounts(ctx, id);
  } catch (error) {
    if (error instanceof AppError && (error.code === "NOT_FOUND" || error.code === "FORBIDDEN")) notFound();
    throw error;
  }
  const canManage = can(ctx.role, "bank:manage");

  return (
    <div className="space-y-6">
      <Link href={`/mukellefler/${data.taxpayer.id}`} className="text-xs font-medium text-ink-3 hover:text-ink">
        ← {data.taxpayer.title}
      </Link>
      <PageHeader title="Banka" description={`${data.taxpayer.title} · ekstre aktarımı ve mutabakat`} />

      <Card>
        <CardHeader title="Banka hesapları" />
        {data.accounts.length === 0 ? (
          <EmptyState title="Banka hesabı yok" description={canManage ? "Aşağıdan ekleyin; ekstreleri hesap sayfasından aktarırsınız." : undefined} />
        ) : (
          <ul className="divide-y divide-line">
            {data.accounts.map((a) => (
              <li key={a.id}>
                <Link href={`/mukellefler/${data.taxpayer.id}/banka/${a.id}`} className="grid gap-2 px-5 py-3 text-sm transition hover:bg-surface-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-ink">{a.name}</span>
                      {a.pending > 0 ? <Badge tone="warning">{a.pending} bekleyen hareket</Badge> : <Badge tone="good">Bekleyen yok</Badge>}
                      {!a.isActive && <Badge>Pasif</Badge>}
                    </div>
                    <p className="mt-0.5 truncate font-mono text-xs text-ink-3">
                      {[a.bankName, a.iban, `${a.ledgerAccount.code} ${a.ledgerAccount.name}`].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  {a.lastStatement && (
                    <div className="flex flex-wrap items-center gap-2 text-xs sm:flex-col sm:items-end sm:gap-1">
                      <span className="text-ink-3">Son ekstre {formatDate(a.lastStatement.periodEnd)}</span>
                      {a.lastStatement.closingBalance && <span className="font-mono text-ink">{formatMoney(a.lastStatement.closingBalance, "TRY")}</span>}
                      <Badge tone={CHECK[a.lastStatement.balanceCheck].tone}>{CHECK[a.lastStatement.balanceCheck].label}</Badge>
                    </div>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
        {canManage &&
          (data.ledgerAccounts.length > 0 ? (
            <div className="border-t border-line">
              <BankAccountForm taxpayerId={data.taxpayer.id} ledgerAccounts={data.ledgerAccounts} />
            </div>
          ) : (
            <p className="border-t border-line px-5 py-3 text-xs text-ink-3">
              Banka hesabı eklemek için önce{" "}
              <Link href={`/mukellefler/${data.taxpayer.id}/hesap-plani`} className="font-medium text-brand-ink hover:underline">
                hesap planını
              </Link>{" "}
              başlatın.
            </p>
          ))}
      </Card>
      <p className="text-xs text-ink-3">
        Ekstreler bankaya özel değil, sütun eşlemesiyle okunur (Excel .xlsx veya CSV). PDF ekstre okuma geliştirme aşamasında.
      </p>
    </div>
  );
}
