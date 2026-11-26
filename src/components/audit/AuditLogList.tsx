"use client";

import { useState } from "react";
import { api } from "@/lib/apiClient";
import { Alert, buttonClass, EmptyState, formatDateTime } from "@/components/ui/primitives";
import { auditLabel } from "./auditLabels";

export interface AuditRow {
  id: string;
  action: string;
  resourceType: string;
  actorName: string | null;
  ipAddress: string | null;
  createdAt: string;
}

/** İşlem geçmişi: ilk sayfa sunucudan gelir, devamı imleçle API'den yüklenir. */
export function AuditLogList({ initial, nextCursor }: { initial: AuditRow[]; nextCursor: string | null }) {
  const [rows, setRows] = useState(initial);
  const [cursor, setCursor] = useState(nextCursor);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const more = async () => {
    if (!cursor) return;
    setBusy(true);
    try {
      const page = await api<{ items: AuditRow[]; nextCursor: string | null }>(`/api/v1/audit-logs?limit=50&cursor=${cursor}`);
      setRows((r) => [...r, ...page.items]);
      setCursor(page.nextCursor);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (rows.length === 0) return <EmptyState title="Henüz kayıt yok" />;
  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[36rem] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-[11px] font-medium uppercase tracking-wider text-ink-3">
              <th className="px-5 py-2.5 font-medium">Zaman</th>
              <th className="px-3 py-2.5 font-medium">İşlem</th>
              <th className="px-3 py-2.5 font-medium">Kişi</th>
              <th className="px-5 py-2.5 font-medium">IP</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="whitespace-nowrap px-5 py-2 font-mono text-xs text-ink-3">{formatDateTime(r.createdAt)}</td>
                <td className="px-3 py-2 text-ink">{auditLabel(r.action)}</td>
                <td className="px-3 py-2 text-ink-2">{r.actorName ?? "—"}</td>
                <td className="px-5 py-2 font-mono text-xs text-ink-3">{r.ipAddress ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {error && (
        <div className="px-5 py-3">
          <Alert>{error}</Alert>
        </div>
      )}
      {cursor && (
        <div className="border-t border-line px-5 py-3">
          <button type="button" className={buttonClass.secondary} onClick={more} disabled={busy}>
            {busy ? "Yükleniyor…" : "Daha eski kayıtlar"}
          </button>
        </div>
      )}
    </div>
  );
}
