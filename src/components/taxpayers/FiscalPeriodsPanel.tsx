"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { api } from "@/lib/apiClient";
import { Alert, Badge, buttonClass, CardHeader, EmptyState, Field, formatDate, inputClass } from "@/components/ui/primitives";

export interface PeriodRow {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: "OPEN" | "CLOSED";
}

/** Mali dönemler: listele, takvim yılı veya özel aralıkla aç, kapat / yeniden aç. */
export function FiscalPeriodsPanel({ taxpayerId, periods, canManage }: { taxpayerId: string; periods: PeriodRow[]; canManage: boolean }) {
  const router = useRouter();
  // Önerilen dönem: bu yıl yoksa bu yıl, varsa açılmamış ilk sonraki yıl
  let year = new Date().getFullYear();
  while (periods.some((p) => p.name === String(year))) year += 1;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const target = event.currentTarget;
    void run(async () => {
      await api(`/api/v1/taxpayers/${taxpayerId}/fiscal-periods`, {
        body: { name: form.get("name"), startDate: form.get("startDate"), endDate: form.get("endDate") },
      });
      target.reset();
    });
  };

  return (
    <>
      <CardHeader title="Mali dönemler" description="Belgeler yalnızca açık dönemlere işlenebilir. Dönemler çakışamaz." />
      {periods.length === 0 ? (
        <EmptyState title="Mali dönem yok" description={canManage ? `Örneğin ${year} takvim yılını açın.` : undefined} />
      ) : (
        <ul className="divide-y divide-line">
          {periods.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-3 px-5 py-2.5 text-sm">
              <span className="font-medium text-ink">{p.name}</span>
              <span className="font-mono text-xs text-ink-3">
                {formatDate(p.startDate)} – {formatDate(p.endDate)}
              </span>
              {p.status === "OPEN" ? <Badge tone="good">Açık</Badge> : <Badge>Kapalı</Badge>}
              {canManage && (
                <button
                  type="button"
                  disabled={busy}
                  className={`${buttonClass.ghost} ml-auto`}
                  onClick={() => run(() => api(`/api/v1/taxpayers/${taxpayerId}/fiscal-periods/${p.id}`, { method: "PATCH", body: { status: p.status === "OPEN" ? "CLOSED" : "OPEN" } }))}
                >
                  {p.status === "OPEN" ? "Dönemi kapat" : "Yeniden aç"}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canManage && (
        <form onSubmit={submit} className="grid grid-cols-2 items-end gap-3 border-t border-line px-5 py-4">
          <div className="col-span-2">
            <Field label="Dönem adı">
              <input name="name" required defaultValue={String(year)} className={inputClass} />
            </Field>
          </div>
          <Field label="Başlangıç">
            <input name="startDate" type="date" required defaultValue={`${year}-01-01`} className={inputClass} />
          </Field>
          <Field label="Bitiş">
            <input name="endDate" type="date" required defaultValue={`${year}-12-31`} className={inputClass} />
          </Field>
          <button type="submit" className={`${buttonClass.primary} col-span-2`} disabled={busy}>
            Dönem aç
          </button>
        </form>
      )}
      {error && (
        <div className="px-5 pb-4">
          <Alert>{error}</Alert>
        </div>
      )}
    </>
  );
}
