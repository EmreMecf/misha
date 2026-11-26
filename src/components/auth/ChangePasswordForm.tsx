"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { api } from "@/lib/apiClient";
import { Alert, buttonClass, Field, inputClass } from "@/components/ui/primitives";

export function ChangePasswordForm({ forced }: { forced: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const target = event.currentTarget;
    if (form.get("newPassword") !== form.get("newPasswordAgain")) {
      setError("Yeni parolalar aynı değil");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api("/api/v1/auth/change-password", { body: { currentPassword: form.get("currentPassword"), newPassword: form.get("newPassword") } });
      target.reset();
      setDone(true);
      if (forced) {
        router.replace("/");
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="max-w-md space-y-4 px-5 py-5">
      <Field label={forced ? "Geçici parola" : "Mevcut parola"}>
        <input name="currentPassword" type="password" required autoComplete="current-password" className={inputClass} />
      </Field>
      <Field label="Yeni parola" hint="En az 10 karakter">
        <input name="newPassword" type="password" required minLength={10} autoComplete="new-password" className={inputClass} />
      </Field>
      <Field label="Yeni parola (tekrar)">
        <input name="newPasswordAgain" type="password" required minLength={10} autoComplete="new-password" className={inputClass} />
      </Field>
      {error && <Alert>{error}</Alert>}
      {done && <Alert tone="good">Parolanız değiştirildi; diğer cihazlardaki oturumlarınız kapatıldı.</Alert>}
      <button type="submit" className={buttonClass.primary} disabled={busy}>
        Parolayı değiştir
      </button>
    </form>
  );
}
