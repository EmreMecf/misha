"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { api, ApiError } from "@/lib/apiClient";
import { Alert, buttonClass, Field, inputClass } from "@/components/ui/primitives";

/** Yalnızca uygulama içi yollara dönüş (açık yönlendirme açığına karşı). */
const safeNext = (value: string | null) => (value && value.startsWith("/") && !value.startsWith("//") ? value : "/");

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ mustChangePassword: boolean }>("/api/v1/auth/login", {
        body: { email: form.get("email"), password: form.get("password") },
      });
      router.replace(result.mustChangePassword ? "/hesabim?zorunlu=1" : safeNext(params.get("next")));
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4 rounded-xl border border-line bg-surface p-6">
      <h1 className="text-lg font-semibold text-ink">Giriş yap</h1>
      <Field label="E-posta">
        <input name="email" type="email" required autoComplete="username" className={inputClass} autoFocus />
      </Field>
      <Field label="Parola">
        <input name="password" type="password" required autoComplete="current-password" className={inputClass} />
      </Field>
      {error && <Alert>{error}</Alert>}
      <button type="submit" className={`${buttonClass.primary} w-full`} disabled={busy}>
        {busy ? "Giriş yapılıyor…" : "Giriş yap"}
      </button>
      <p className="text-center text-xs text-ink-3">
        Ofisiniz kayıtlı değil mi?{" "}
        <Link href="/kayit" className="font-medium text-brand hover:underline">
          Ofis hesabı oluşturun
        </Link>
      </p>
    </form>
  );
}

export function RegisterForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (form.get("password") !== form.get("passwordAgain")) {
      setFieldErrors({ passwordAgain: ["Parolalar aynı değil"] });
      return;
    }
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      await api("/api/v1/auth/register", {
        body: {
          organizationName: form.get("organizationName"),
          organizationTaxId: form.get("organizationTaxId") || undefined,
          fullName: form.get("fullName"),
          email: form.get("email"),
          password: form.get("password"),
        },
      });
      router.replace("/");
      router.refresh();
    } catch (e) {
      if (e instanceof ApiError && e.fieldErrors) setFieldErrors(e.fieldErrors);
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const fe = (k: string) => fieldErrors[k]?.[0];
  return (
    <form onSubmit={submit} className="space-y-4 rounded-xl border border-line bg-surface p-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">Ofis hesabı oluşturun</h1>
        <p className="mt-1 text-xs text-ink-3">Muhasebe ofisiniz ve ofis sahibi hesabınız oluşturulur. Personeli sonra eklersiniz.</p>
      </div>
      <Field label="Ofis adı" error={fe("organizationName")}>
        <input name="organizationName" required minLength={2} className={inputClass} placeholder="Örnek Mali Müşavirlik" />
      </Field>
      <Field label="Ofis VKN / TCKN (isteğe bağlı)" error={fe("organizationTaxId")}>
        <input name="organizationTaxId" inputMode="numeric" className={`${inputClass} font-mono`} />
      </Field>
      <Field label="Ad soyad" error={fe("fullName")}>
        <input name="fullName" required minLength={2} autoComplete="name" className={inputClass} />
      </Field>
      <Field label="E-posta" error={fe("email")}>
        <input name="email" type="email" required autoComplete="username" className={inputClass} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Parola" hint="En az 10 karakter" error={fe("password")}>
          <input name="password" type="password" required minLength={10} autoComplete="new-password" className={inputClass} />
        </Field>
        <Field label="Parola (tekrar)" error={fe("passwordAgain")}>
          <input name="passwordAgain" type="password" required minLength={10} autoComplete="new-password" className={inputClass} />
        </Field>
      </div>
      {error && <Alert>{error}</Alert>}
      <button type="submit" className={`${buttonClass.primary} w-full`} disabled={busy}>
        {busy ? "Oluşturuluyor…" : "Ofisi oluştur"}
      </button>
      <p className="text-center text-xs text-ink-3">
        Hesabınız var mı?{" "}
        <Link href="/giris" className="font-medium text-brand hover:underline">
          Giriş yapın
        </Link>
      </p>
    </form>
  );
}
