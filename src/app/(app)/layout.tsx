import { Suspense } from "react";
import { connection } from "next/server";
import { AppShell } from "@/components/shell/AppShell";
import { listUserOrganizations } from "@/server/auth/authService";
import { getPageContext } from "@/server/tenancy/pageContext";
import { can, ROLE_LABELS, type Permission } from "@/server/tenancy/permissions";

// Menü yalnızca tamamlanmış ve rolün erişebildiği modülleri gösterir.
const NAV: Array<{ href: string; label: string; permission?: Permission }> = [
  { href: "/", label: "Genel Bakış" },
  { href: "/mukellefler", label: "Mükellefler", permission: "taxpayer:read" },
  { href: "/personel", label: "Personel ve Yetkiler", permission: "member:read" },
  { href: "/islem-gecmisi", label: "İşlem Geçmişi", permission: "audit:read" },
];

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <Suspense fallback={<div className="flex-1 bg-canvas" />}>
      <Shell>{children}</Shell>
    </Suspense>
  );
}

async function Shell({ children }: { children: React.ReactNode }) {
  await connection();
  const ctx = await getPageContext({ allowPasswordChange: true });
  const organizations = await listUserOrganizations(ctx.userId);
  return (
    <AppShell
      data={{
        fullName: ctx.fullName,
        email: ctx.email,
        roleLabel: ROLE_LABELS[ctx.role],
        organizationId: ctx.organizationId,
        organizations: organizations.map((o) => ({ id: o.organizationId, name: o.organization.name })),
        nav: ctx.mustChangePassword ? [] : NAV.filter((n) => !n.permission || can(ctx.role, n.permission)).map(({ href, label }) => ({ href, label })),
      }}
    >
      {children}
    </AppShell>
  );
}
