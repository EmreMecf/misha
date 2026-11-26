import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { AccountList, InitChart, PostingRules, RoleMappings } from "@/components/ledger/ChartPanels";
import { Card, PageHeader } from "@/components/ui/primitives";
import { AppError } from "@/server/errors";
import { ACCOUNT_ROLES, getChart, listPostingRules } from "@/server/ledger/chartService";
import { ACCOUNT_ROLE_LABELS } from "@/server/ledger/tdhpTemplate";
import { getPageContext } from "@/server/tenancy/pageContext";
import { can } from "@/server/tenancy/permissions";

export const metadata = { title: "Hesap planı" };

export default function ChartPage({ params }: PageProps<"/mukellefler/[id]/hesap-plani">) {
  return (
    <Suspense fallback={<div className="h-64 animate-pulse rounded-xl bg-surface-2" />}>
      <Chart params={params} />
    </Suspense>
  );
}

async function Chart({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const ctx = await getPageContext();
  const { id } = await params;
  let chart, rules;
  try {
    [chart, rules] = await Promise.all([getChart(ctx, id), listPostingRules(ctx, id)]);
  } catch (error) {
    if (error instanceof AppError && (error.code === "NOT_FOUND" || error.code === "FORBIDDEN")) notFound();
    throw error;
  }
  const canManage = can(ctx.role, "ledger:manage");
  const accounts = chart.accounts.map((a) => ({ id: a.id, code: a.code, name: a.name, isActive: a.isActive, isPostable: a.isPostable }));
  const mapped = new Map(chart.mappings.map((m) => [m.role, m.accountId]));

  return (
    <div className="space-y-6">
      <Link href={`/mukellefler/${chart.taxpayer.id}`} className="text-xs font-medium text-ink-3 hover:text-ink">
        ← {chart.taxpayer.title}
      </Link>
      <PageHeader title="Hesap planı" description={`${chart.taxpayer.title} · mükellefe özel hesaplar, rol eşlemeleri ve öğrenilen kurallar`} />

      {accounts.length === 0 ? (
        <Card>
          <InitChart taxpayerId={chart.taxpayer.id} canManage={canManage} />
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <Card className="min-w-0 self-start">
            <AccountList taxpayerId={chart.taxpayer.id} accounts={accounts} canManage={canManage} />
          </Card>
          <div className="min-w-0 space-y-6">
            <Card>
              <RoleMappings
                taxpayerId={chart.taxpayer.id}
                accounts={accounts}
                canManage={canManage}
                roles={ACCOUNT_ROLES.map((role) => ({ role, label: ACCOUNT_ROLE_LABELS[role], accountId: mapped.get(role) ?? null }))}
              />
            </Card>
            <Card>
              <PostingRules
                taxpayerId={chart.taxpayer.id}
                canManage={canManage}
                rules={rules.map((r) => ({
                  id: r.id,
                  counterpartyTaxId: r.counterpartyTaxId,
                  counterpartyName: r.counterpartyName,
                  direction: r.direction,
                  account: `${r.account.code} ${r.account.name}`,
                  isActive: r.isActive,
                }))}
              />
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
