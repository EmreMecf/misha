import { Suspense } from "react";
import { connection } from "next/server";
import { MembersPanel } from "@/components/members/MembersPanel";
import { Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { listMembers } from "@/server/tenancy/memberService";
import { getPageContext } from "@/server/tenancy/pageContext";
import { can, ROLE_LABELS } from "@/server/tenancy/permissions";

export const metadata = { title: "Personel ve Yetkiler" };

export default function MembersPage() {
  return (
    <Suspense fallback={<div className="h-64 animate-pulse rounded-xl bg-surface-2" />}>
      <Members />
    </Suspense>
  );
}

async function Members() {
  await connection();
  const ctx = await getPageContext();
  if (!can(ctx.role, "member:read")) {
    return (
      <Card>
        <EmptyState title="Bu sayfayı görme yetkiniz yok" />
      </Card>
    );
  }
  const members = await listMembers(ctx);
  return (
    <div className="space-y-6">
      <PageHeader title="Personel ve Yetkiler" description="Rol, kişinin hangi işlemleri yapabileceğini belirler. Personel yalnızca atandığı mükellefleri görür." />
      <MembersPanel
        canManage={can(ctx.role, "member:manage")}
        roleLabels={ROLE_LABELS}
        members={members.map((m) => ({
          id: m.id,
          fullName: m.user.fullName,
          email: m.user.email,
          role: m.role,
          status: m.status,
          assignmentCount: m._count.assignments,
          isSelf: m.id === ctx.membershipId,
        }))}
      />
    </div>
  );
}
