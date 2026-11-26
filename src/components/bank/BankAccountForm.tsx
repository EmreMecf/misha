"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Alert, buttonClass, cx, Field, inputClass } from "@/components/ui/primitives";
import { api } from "@/lib/apiClient";

/** Banka hesabı ekleme: ad, banka, IBAN (isteğe bağlı), defter hesabı (10x). */
export function BankAccountForm({ taxpayerId, ledgerAccounts }: { taxpayerId: string; ledgerAccounts: Array<{ id: string; code: string; name: string }> }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const defaultLedger = ledgerAccounts.find((a) => a.code === "102") ?? ledgerAccounts[0];

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    setError(null);
    try {
      await api(`/api/v1/taxpayers/${taxpayerId}/bank-accounts`, {
        body: { name: data.get("name"), bankName: data.get("bankName") || null, iban: data.get("iban") || null, ledgerAccountId: data.get("ledgerAccountId") },
      });
      form.reset();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="grid gap-3 px-5 py-4 sm:grid-cols-2">
      <Field label="Hesap adı" hint="Ör. Örnek Bankası TL vadesiz">
        <input name="name" required minLength={2} maxLength={120} className={inputClass} />
      </Field>
      <Field label="Banka">
        <input name="bankName" maxLength={120} className={inputClass} />
      </Field>
      <Field label="IBAN" hint="İsteğe bağlı; kontrol basamağı doğrulanır">
        <input name="iban" className={cx(inputClass, "font-mono")} placeholder="TR00 0000 0000 0000 0000 0000 00" />
      </Field>
      <Field label="Defter hesabı" hint="Hareketler bu hesaba işlenir (alt hesap için önce hesap planından 102.01 açın)">
        <select name="ledgerAccountId" required defaultValue={defaultLedger?.id} className={cx(inputClass, "font-mono text-xs")}>
          {ledgerAccounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.code} {a.name}
            </option>
          ))}
        </select>
      </Field>
      <div className="flex items-end gap-3 sm:col-span-2">
        <button type="submit" className={buttonClass.primary} disabled={busy}>
          Banka hesabı ekle
        </button>
        {error && <Alert>{error}</Alert>}
      </div>
    </form>
  );
}
