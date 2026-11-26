"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { api, ApiError } from "@/lib/apiClient";
import { Alert, buttonClass, Field, inputClass } from "@/components/ui/primitives";

export interface TaxpayerFormValues {
  id?: string;
  version?: number;
  title: string;
  taxId: string;
  taxOffice: string | null;
  naceCode: string | null;
  activity: string | null;
  ledgerType: "BILANCO" | "ISLETME" | "SERBEST_MESLEK";
  address: string | null;
  status?: "ACTIVE" | "ARCHIVED";
}

const LEDGERS = [
  ["BILANCO", "Bilanço esası"],
  ["ISLETME", "İşletme hesabı"],
  ["SERBEST_MESLEK", "Serbest meslek kazanç defteri"],
] as const;

/** Mükellef ekleme/düzenleme formu. Düzenlemede VKN değiştirilemez, sürüm (iyimser kilit) gönderilir. */
function TaxpayerFields({ values, editing, fieldErrors }: { values?: TaxpayerFormValues; editing: boolean; fieldErrors: Record<string, string[]> }) {
  const fe = (k: string) => fieldErrors[k]?.[0];
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <Field label="Unvan" error={fe("title")}>
          <input name="title" required minLength={2} defaultValue={values?.title} className={inputClass} />
        </Field>
      </div>
      <Field label="VKN / TCKN" error={fe("taxId")} hint={editing ? "Kimlik numarası değiştirilemez" : "10 haneli VKN veya 11 haneli TCKN"}>
        <input name="taxId" required inputMode="numeric" disabled={editing} defaultValue={values?.taxId} className={`${inputClass} font-mono`} />
      </Field>
      <Field label="Vergi dairesi" error={fe("taxOffice")}>
        <input name="taxOffice" defaultValue={values?.taxOffice ?? ""} className={inputClass} />
      </Field>
      <Field label="Defter türü" error={fe("ledgerType")}>
        <select name="ledgerType" defaultValue={values?.ledgerType ?? "BILANCO"} className={inputClass}>
          {LEDGERS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </Field>
      <Field label="NACE kodu" error={fe("naceCode")} hint="ör. 69.20.01">
        <input name="naceCode" defaultValue={values?.naceCode ?? ""} className={`${inputClass} font-mono`} />
      </Field>
      <div className="sm:col-span-2">
        <Field label="Faaliyet alanı" error={fe("activity")}>
          <input name="activity" defaultValue={values?.activity ?? ""} className={inputClass} />
        </Field>
      </div>
      <div className="sm:col-span-2">
        <Field label="Adres" error={fe("address")}>
          <textarea name="address" rows={2} defaultValue={values?.address ?? ""} className={inputClass} />
        </Field>
      </div>
    </div>
  );
}

const read = (form: FormData) => ({
  title: String(form.get("title") ?? ""),
  taxOffice: String(form.get("taxOffice") ?? "") || undefined,
  naceCode: String(form.get("naceCode") ?? "") || undefined,
  activity: String(form.get("activity") ?? "") || undefined,
  ledgerType: String(form.get("ledgerType") ?? "BILANCO"),
  address: String(form.get("address") ?? "") || undefined,
});

export function NewTaxpayerDialog() {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      const created = await api<{ id: string }>("/api/v1/taxpayers", { body: { ...read(form), taxId: form.get("taxId") } });
      dialog.current?.close();
      router.push(`/mukellefler/${created.id}`);
      router.refresh();
    } catch (e) {
      if (e instanceof ApiError && e.fieldErrors) setFieldErrors(e.fieldErrors);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button type="button" className={buttonClass.primary} onClick={() => dialog.current?.showModal()}>
        Mükellef ekle
      </button>
      <dialog ref={dialog} className="m-auto w-[min(40rem,calc(100vw-2rem))] rounded-xl border border-line bg-surface p-0 text-ink backdrop:bg-black/40">
        <form onSubmit={submit}>
          <div className="border-b border-line px-6 py-4">
            <h2 className="text-base font-semibold">Yeni mükellef</h2>
          </div>
          <div className="space-y-4 px-6 py-5">
            <TaxpayerFields editing={false} fieldErrors={fieldErrors} />
            {error && <Alert>{error}</Alert>}
          </div>
          <div className="flex justify-end gap-2 border-t border-line px-6 py-4">
            <button type="button" className={buttonClass.secondary} onClick={() => dialog.current?.close()}>
              Vazgeç
            </button>
            <button type="submit" className={buttonClass.primary} disabled={busy}>
              {busy ? "Kaydediliyor…" : "Mükellefi ekle"}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}

export function EditTaxpayerForm({ values, canEdit }: { values: TaxpayerFormValues; canEdit: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    setSaved(false);
    setFieldErrors({});
    try {
      await api(`/api/v1/taxpayers/${values.id}`, { method: "PATCH", body: { ...read(form), version: values.version } });
      setSaved(true);
      router.refresh();
    } catch (e) {
      if (e instanceof ApiError && e.fieldErrors) setFieldErrors(e.fieldErrors);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const archive = async (status: "ACTIVE" | "ARCHIVED") => {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/v1/taxpayers/${values.id}`, { method: "PATCH", body: { status, version: values.version } });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4 px-5 py-5">
      <fieldset disabled={!canEdit} className="contents">
        <TaxpayerFields values={values} editing fieldErrors={fieldErrors} />
      </fieldset>
      {error && <Alert>{error}</Alert>}
      {saved && <Alert tone="good">Değişiklikler kaydedildi.</Alert>}
      {canEdit && (
        <div className="flex flex-wrap gap-2">
          <button type="submit" className={buttonClass.primary} disabled={busy}>
            Kaydet
          </button>
          {values.status === "ARCHIVED" ? (
            <button type="button" className={buttonClass.secondary} disabled={busy} onClick={() => archive("ACTIVE")}>
              Arşivden çıkar
            </button>
          ) : (
            <button type="button" className={buttonClass.danger} disabled={busy} onClick={() => archive("ARCHIVED")}>
              Arşivle
            </button>
          )}
        </div>
      )}
    </form>
  );
}
