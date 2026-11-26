"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { api } from "@/lib/apiClient";
import { Alert, buttonClass, Field, inputClass } from "@/components/ui/primitives";

/** Kontrol işlemleri: onayla (kontrol edildi), reddet (neden zorunlu), yeniden işle. */
export function DocumentActions({
  documentId,
  canReview,
  canReprocess,
  canReject,
}: {
  documentId: string;
  canReview: boolean;
  canReprocess: boolean;
  canReject: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);

  const run = async (body: Record<string, string>) => {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/v1/documents/${documentId}/actions`, { body });
      setRejecting(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const reject = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void run({ action: "reject", reason: String(new FormData(event.currentTarget).get("reason") ?? "") });
  };

  if (!canReview && !canReprocess && !canReject) return null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {canReview && (
          <button type="button" className={buttonClass.primary} disabled={busy} onClick={() => run({ action: "review" })}>
            Kontrol edildi
          </button>
        )}
        {canReprocess && (
          <button type="button" className={buttonClass.secondary} disabled={busy} onClick={() => run({ action: "reprocess" })}>
            Yeniden işle
          </button>
        )}
        {canReject && !rejecting && (
          <button type="button" className={buttonClass.danger} disabled={busy} onClick={() => setRejecting(true)}>
            Reddet
          </button>
        )}
      </div>
      {rejecting && (
        <form onSubmit={reject} className="space-y-2 rounded-lg border border-line p-3">
          <Field label="Ret nedeni" hint="İşlem geçmişine kaydedilir.">
            <textarea name="reason" required minLength={3} maxLength={500} rows={2} className={inputClass} autoFocus />
          </Field>
          <div className="flex gap-2">
            <button type="submit" className={buttonClass.primary} disabled={busy}>
              Reddet
            </button>
            <button type="button" className={buttonClass.ghost} disabled={busy} onClick={() => setRejecting(false)}>
              Vazgeç
            </button>
          </div>
        </form>
      )}
      {error && <Alert>{error}</Alert>}
    </div>
  );
}
