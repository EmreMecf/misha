"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type DragEvent } from "react";
import { Alert, Badge, buttonClass, cx } from "@/components/ui/primitives";

interface UploadResult {
  fileName: string;
  outcome: "QUEUED" | "DUPLICATE" | "REJECTED";
  documentId?: string;
  message?: string;
}

const OUTCOME = {
  QUEUED: { label: "Sıraya alındı", tone: "good" },
  DUPLICATE: { label: "Mükerrer", tone: "warning" },
  REJECTED: { label: "Reddedildi", tone: "critical" },
} as const;

const ACCEPT = ".xml,.zip,.pdf,.png,.jpg,.jpeg,.webp,.xls,.xlsx,.csv";

/** Çoklu dosya / ZIP yükleme: sürükle-bırak veya dosya seçici; her dosyanın sonucu ayrı gösterilir. */
export function DocumentUpload({ taxpayerId }: { taxpayerId: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<UploadResult[]>([]);

  const upload = async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (list.length === 0) return;
    setBusy(true);
    setError(null);
    setResults([]);
    try {
      const body = new FormData();
      for (const f of list) body.append("files", f);
      const response = await fetch(`/api/v1/taxpayers/${taxpayerId}/documents`, { method: "POST", body, cache: "no-store" });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json?.error?.message ?? `Yükleme başarısız (${response.status})`);
      setResults(json.results ?? []);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    if (!busy) void upload(event.dataTransfer.files);
  };

  return (
    <div className="space-y-3 p-5">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cx(
          "flex flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-8 text-center transition",
          dragging ? "border-brand bg-brand-soft" : "border-line bg-surface-2",
        )}
      >
        <p className="text-sm font-medium text-ink">Belgeleri buraya bırakın</p>
        <p className="max-w-md text-xs text-ink-3">
          e-Fatura / e-Arşiv XML, ZIP (içindeki tüm faturalar), PDF veya görsel. Dosya başına en fazla 25 MB, tek seferde 50 dosya.
        </p>
        <input
          ref={input}
          id="belge-yukle"
          type="file"
          multiple
          accept={ACCEPT}
          className="sr-only"
          disabled={busy}
          onChange={(e) => e.target.files && upload(e.target.files)}
        />
        <label htmlFor="belge-yukle" className={cx(buttonClass.primary, "mt-2 cursor-pointer", busy && "pointer-events-none opacity-50")}>
          {busy ? "Yükleniyor…" : "Dosya seç"}
        </label>
      </div>
      {error && <Alert>{error}</Alert>}
      {results.length > 0 && (
        <ul aria-label="Yükleme sonuçları" className="divide-y divide-line rounded-lg border border-line">
          {results.map((r, i) => (
            <li key={`${r.fileName}-${i}`} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink">{r.fileName}</span>
              <Badge tone={OUTCOME[r.outcome].tone}>{OUTCOME[r.outcome].label}</Badge>
              {r.message && <span className="basis-full text-xs text-ink-3">{r.message}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
