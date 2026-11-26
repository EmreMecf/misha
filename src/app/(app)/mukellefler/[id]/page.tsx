import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { connection } from "next/server";
import { AssignmentsPanel } from "@/components/taxpayers/AssignmentsPanel";
import { FiscalPeriodsPanel } from "@/components/taxpayers/FiscalPeriodsPanel";
import { EditTaxpayerForm } from "@/components/taxpayers/TaxpayerForm";
import { Badge, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { AppError } from "@/server/errors";
import { listMembers } from "@/server/tenancy/memberService";
import { getPageContext } from "@/server/tenancy/pageContext";
import { can, ROLE_LABELS } from "@/server/tenancy/permissions";
import { getTaxpayer } from "@/server/taxpayers/taxpayerService";

export const metadata = { title: "Mükellef" };

export default function TaxpayerPage({ params }: PageProps<"/mukellefler/[id]">) {
  return (
    <Suspense fallback={<div className="h-64 animate-pulse rounded-xl bg-surface-2" />}>
      <TaxpayerDetail params={params} />
    </Suspense>
  );
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

async function TaxpayerDetail({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const ctx = await getPageContext();
  const { id } = await params;
  let taxpayer;
  try {
    taxpayer = await getTaxpayer(ctx, id);
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  const canAssign = can(ctx.role, "taxpayer:assign");
  const members = canAssign ? await listMembers(ctx) : [];

  return (
    <div className="space-y-6">
      <Link href="/mukellefler" className="text-xs font-medium text-ink-3 hover:text-ink">
        ← Mükellefler
      </Link>
      <PageHeader
        title={taxpayer.title}
        description={`${taxpayer.taxIdType} ${taxpayer.taxId}${taxpayer.taxOffice ? ` · ${taxpayer.taxOffice}` : ""}`}
        action={taxpayer.status === "ACTIVE" ? <Badge tone="good">Aktif</Badge> : <Badge>Arşivde</Badge>}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card>
          <CardHeader title="Mükellef bilgileri" />
          <EditTaxpayerForm
            canEdit={can(ctx.role, "taxpayer:update")}
            values={{
              id: taxpayer.id,
              version: taxpayer.version,
              title: taxpayer.title,
              taxId: taxpayer.taxId,
              taxOffice: taxpayer.taxOffice,
              naceCode: taxpayer.naceCode,
              activity: taxpayer.activity,
              ledgerType: taxpayer.ledgerType,
              address: taxpayer.address,
              status: taxpayer.status,
            }}
          />
        </Card>
        <div className="space-y-6">
          <Card>
            <FiscalPeriodsPanel
              taxpayerId={taxpayer.id}
              canManage={can(ctx.role, "period:manage")}
              periods={taxpayer.fiscalPeriods.map((p) => ({ id: p.id, name: p.name, startDate: iso(p.startDate), endDate: iso(p.endDate), status: p.status }))}
            />
          </Card>
          <Card>
            <AssignmentsPanel
              taxpayerId={taxpayer.id}
              canAssign={canAssign}
              assigned={taxpayer.assignments.map((a) => ({
                membershipId: a.membership.id,
                fullName: a.membership.user.fullName,
                email: a.membership.user.email,
                roleLabel: ROLE_LABELS[a.membership.role],
              }))}
              candidates={members
                .filter((m) => m.status === "ACTIVE" && ["STAFF", "TAXPAYER_USER", "READ_ONLY"].includes(m.role))
                .map((m) => ({ membershipId: m.id, fullName: m.user.fullName, email: m.user.email, roleLabel: ROLE_LABELS[m.role] }))}
            />
          </Card>
        </div>
      </div>
    </div>
  );
}
