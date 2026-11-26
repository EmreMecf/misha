import { Suspense } from "react";
import { connection } from "next/server";
import { ChangePasswordForm } from "@/components/auth/ChangePasswordForm";
import { Alert, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { getPageContext } from "@/server/tenancy/pageContext";
import { ROLE_LABELS } from "@/server/tenancy/permissions";

export const metadata = { title: "Hesabım" };

export default function AccountPage() {
  return (
    <Suspense fallback={<div className="h-64 animate-pulse rounded-xl bg-surface-2" />}>
      <Account />
    </Suspense>
  );
}

async function Account() {
  await connection();
  const ctx = await getPageContext({ allowPasswordChange: true });
  return (
    <div className="space-y-6">
      <PageHeader title="Hesabım" description={`${ctx.fullName} · ${ctx.email} · ${ROLE_LABELS[ctx.role]}`} />
      {ctx.mustChangePassword && <Alert tone="warning">Geçici parolayla giriş yaptınız. Devam etmek için kendi parolanızı belirleyin.</Alert>}
      <Card>
        <CardHeader title="Parola" description="Parola değişince diğer cihazlardaki oturumlarınız kapatılır." />
        <ChangePasswordForm forced={ctx.mustChangePassword} />
      </Card>
    </div>
  );
}
