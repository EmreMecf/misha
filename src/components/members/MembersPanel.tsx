"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { api, ApiError } from "@/lib/apiClient";
import { Alert, Badge, buttonClass, Field, inputClass } from "@/components/ui/primitives";

type RoleKey = "OFFICE_OWNER" | "ACCOUNTANT" | "STAFF" | "AUDITOR" | "TAXPAYER_USER" | "READ_ONLY";

export interface MemberRow {
  id: string;
  fullName: string;
  email: string;
  role: RoleKey;
  status: "ACTIVE" | "ARCHIVED";
  assignmentCount: number;
  isSelf: boolean;
}

export function MembersPanel({ members, roleLabels, canManage }: { members: MemberRow[]; roleLabels: Record<RoleKey, string>; canManage: boolean }) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [created, setCreated] = useState<{ email: string; password: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const roles = Object.keys(roleLabels) as RoleKey[];

  const update = async (id: string, body: { role?: RoleKey; status?: "ACTIVE" | "ARCHIVED" }) => {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/v1/members/${id}`, { method: "PATCH", body });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const add = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      const result = await api<{ temporaryPassword: string | null }>("/api/v1/members", {
        body: { email: form.get("email"), fullName: form.get("fullName"), role: form.get("role") },
      });
      setCreated({ email: String(form.get("email")), password: result.temporaryPassword });
      dialog.current?.close();
      router.refresh();
    } catch (e) {
      if (e instanceof ApiError && e.fieldErrors) setFieldErrors(e.fieldErrors);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {canManage && (
        <div className="flex justify-end">
          <button type="button" className={buttonClass.primary} onClick={() => dialog.current?.showModal()}>
            Personel ekle
          </button>
        </div>
      )}

      {created && (
        <div className="rounded-xl border border-line bg-surface p-4 text-sm">
          {created.password ? (
            <>
              <p className="font-medium text-ink">{created.email} için hesap oluşturuldu.</p>
              <p className="mt-1 text-ink-2">
                Geçici parola (yalnızca şimdi gösterilir; kişiye güvenli bir yoldan iletin, ilk girişte değiştirmesi istenecek):
              </p>
              <p className="mt-2 select-all rounded-lg bg-surface-2 px-3 py-2 font-mono text-base text-ink">{created.password}</p>
            </>
          ) : (
            <p className="text-ink">{created.email} zaten bir hesaba sahip; ofisinize eklendi. Mevcut parolasıyla giriş yapar.</p>
          )}
          <button type="button" className={`${buttonClass.ghost} mt-2`} onClick={() => setCreated(null)}>
            Kapat
          </button>
        </div>
      )}

      {error && <Alert>{error}</Alert>}

      <div className="overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full min-w-[40rem] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-[11px] font-medium uppercase tracking-wider text-ink-3">
              <th className="px-5 py-2.5 font-medium">Kişi</th>
              <th className="px-3 py-2.5 font-medium">Rol</th>
              <th className="px-3 py-2.5 text-right font-medium">Atandığı mükellef</th>
              <th className="px-5 py-2.5 font-medium">Durum</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {members.map((m) => (
              <tr key={m.id}>
                <td className="px-5 py-2.5">
                  <span className="block font-medium text-ink">
                    {m.fullName}
                    {m.isSelf && <span className="ml-1 text-xs font-normal text-ink-3">(siz)</span>}
                  </span>
                  <span className="block text-xs text-ink-3">{m.email}</span>
                </td>
                <td className="px-3 py-2.5">
                  {canManage && !m.isSelf ? (
                    <select
                      value={m.role}
                      disabled={busy}
                      onChange={(e) => update(m.id, { role: e.target.value as RoleKey })}
                      aria-label={`${m.fullName} rolü`}
                      className="rounded-lg border border-line bg-surface px-2 py-1 text-sm text-ink"
                    >
                      {roles.map((r) => (
                        <option key={r} value={r}>
                          {roleLabels[r]}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="text-ink-2">{roleLabels[m.role]}</span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums text-ink-2">{m.assignmentCount}</td>
                <td className="px-5 py-2.5">
                  <div className="flex items-center gap-2">
                    {m.status === "ACTIVE" ? <Badge tone="good">Aktif</Badge> : <Badge>Pasif</Badge>}
                    {canManage && !m.isSelf && (
                      <button
                        type="button"
                        disabled={busy}
                        className={m.status === "ACTIVE" ? buttonClass.danger : buttonClass.ghost}
                        onClick={() => update(m.id, { status: m.status === "ACTIVE" ? "ARCHIVED" : "ACTIVE" })}
                      >
                        {m.status === "ACTIVE" ? "Pasifleştir" : "Etkinleştir"}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <dialog ref={dialog} className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-xl border border-line bg-surface p-0 text-ink backdrop:bg-black/40">
        <form onSubmit={add}>
          <div className="border-b border-line px-6 py-4">
            <h2 className="text-base font-semibold">Personel ekle</h2>
            <p className="mt-0.5 text-xs text-ink-3">E-posta sistemde yoksa geçici parolalı hesap açılır.</p>
          </div>
          <div className="space-y-4 px-6 py-5">
            <Field label="Ad soyad" error={fieldErrors.fullName?.[0]}>
              <input name="fullName" required minLength={2} className={inputClass} />
            </Field>
            <Field label="E-posta" error={fieldErrors.email?.[0]}>
              <input name="email" type="email" required className={inputClass} />
            </Field>
            <Field label="Rol">
              <select name="role" defaultValue="STAFF" className={inputClass}>
                {roles.map((r) => (
                  <option key={r} value={r}>
                    {roleLabels[r]}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="flex justify-end gap-2 border-t border-line px-6 py-4">
            <button type="button" className={buttonClass.secondary} onClick={() => dialog.current?.close()}>
              Vazgeç
            </button>
            <button type="submit" className={buttonClass.primary} disabled={busy}>
              Ekle
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
