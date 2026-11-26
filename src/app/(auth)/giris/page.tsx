import { Suspense } from "react";
import { LoginForm } from "@/components/auth/AuthForms";

export const metadata = { title: "Giriş" };

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="h-80 animate-pulse rounded-xl bg-surface-2" />}>
      <LoginForm />
    </Suspense>
  );
}
