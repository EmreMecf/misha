import { Suspense } from "react";
import { connection } from "next/server";
import { AuditLogList } from "@/components/audit/AuditLogList";
import { Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { listAuditLogs } from "@/server/audit/auditQueries";
import { getPageContext } from "@/server/tenancy/pageContext";
import { can } from "@/server/tenancy/permissions";

export const metadata = { title: "İşlem Geçmişi" };

export default function AuditPage() {
  return (
    <Suspense fallback={<div className="h-64 animate-pulse rounded-xl bg-surface-2" />}>
      <Audit />
    </Suspense>
  );
}

async function Audit() {
  await connection();
  const ctx = await getPageContext();
  if (!can(ctx.role, "audit:read")) {
    return (
      <Card>
        <EmptyState title="Bu sayfayı görme yetkiniz yok" />
      </Card>
    );
  }
  const page = await listAuditLogs(ctx, { limit: 50 });
  return (
    <div className="space-y-6">
      <PageHeader title="İşlem Geçmişi" description="Ofisinizde yapılan işlemlerin değiştirilemez kaydı." />
      <Card>
        <AuditLogList
          nextCursor={page.nextCursor}
          initial={page.items.map((r) => ({
            id: r.id,
            action: r.action,
            resourceType: r.resourceType,
            actorName: r.actorName,
            ipAddress: r.ipAddress,
            createdAt: r.createdAt.toISOString(),
          }))}
        />
      </Card>
    </div>
  );
}
