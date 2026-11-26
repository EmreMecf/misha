"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/apiClient";
import { Alert, buttonClass, CardHeader, EmptyState, inputClass } from "@/components/ui/primitives";

export interface AssignmentRow {
  membershipId: string;
  fullName: string;
  email: string;
  roleLabel: string;
}

/** Mükellefe atanmış personel. Atanmamış personel (ve mükellef kullanıcısı) bu mükellefi göremez. */
export function AssignmentsPanel({
  taxpayerId,
  assigned,
  candidates,
  canAssign,
}: {
  taxpayerId: string;
  assigned: AssignmentRow[];
  candidates: AssignmentRow[];
  canAssign: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const available = candidates.filter((c) => !assigned.some((a) => a.membershipId === c.membershipId));

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setSelected("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <CardHeader title="Atanmış personel" description="Ofis sahibi, mali müşavir ve denetçi tüm mükellefleri zaten görür." />
      {assigned.length === 0 ? (
        <EmptyState title="Atanmış personel yok" />
      ) : (
        <ul className="divide-y divide-line">
          {assigned.map((a) => (
            <li key={a.membershipId} className="flex items-center gap-3 px-5 py-2.5 text-sm">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-ink">{a.fullName}</span>
                <span className="block truncate text-xs text-ink-3">
                  {a.roleLabel} · {a.email}
                </span>
              </span>
              {canAssign && (
                <button
                  type="button"
                  className={buttonClass.danger}
                  disabled={busy}
                  onClick={() => run(() => api(`/api/v1/taxpayers/${taxpayerId}/assignments?membershipId=${a.membershipId}`, { method: "DELETE" }))}
                >
                  Kaldır
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canAssign && available.length > 0 && (
        <div className="flex flex-wrap gap-2 border-t border-line px-5 py-4">
          <select value={selected} onChange={(e) => setSelected(e.target.value)} aria-label="Atanacak personel" className={`${inputClass} max-w-xs`}>
            <option value="">Personel seçin…</option>
            {available.map((c) => (
              <option key={c.membershipId} value={c.membershipId}>
                {c.fullName} ({c.roleLabel})
              </option>
            ))}
          </select>
          <button
            type="button"
            className={buttonClass.secondary}
            disabled={!selected || busy}
            onClick={() => run(() => api(`/api/v1/taxpayers/${taxpayerId}/assignments`, { body: { membershipId: selected } }))}
          >
            Ata
          </button>
        </div>
      )}
      {error && (
        <div className="px-5 pb-4">
          <Alert>{error}</Alert>
        </div>
      )}
    </>
  );
}
