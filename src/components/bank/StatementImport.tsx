"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatMoney } from "@/components/documents/format";
import { Alert, Badge, buttonClass, cx, Field, inputClass } from "@/components/ui/primitives";

type MappingField = "date" | "valueDate" | "description" | "amount" | "debit" | "credit" | "balance" | "reference";
type Mapping = Partial<Record<MappingField, number>> & { headerRow: number; invertSign?: boolean };

interface Preview {
  format: "CSV" | "XLSX";
  table: string[][];
  mapping: Mapping | null;
  rows: Array<{ rowNo: number; txDate: string; description: string; reference: string | null; amount: string; balance: string | null }>;
  rowCount: number;
  errors: Array<{ rowNo: number; message: string }>;
  errorCount: number;
  skipped: number;
  duplicates: number;
  balance: { status: "OK" | "MISMATCH" | "NO_BALANCE"; opening: string | null; closing: string | null; mismatches: Array<{ rowNo: number; expected: string; actual: string }> } | null;
}

interface ImportResult {
  rowCount: number;
  imported: number;
  duplicates: number;
  balanceCheck: string;
  findings: Array<{ code: string; severity: "error" | "warning"; message: string }>;
}

const FIELD_LABELS: Array<[MappingField, string]> = [
  ["date", "Tarih *"],
  ["description", "Açıklama"],
  ["amount", "Tutar (işaretli)"],
  ["debit", "Borç (çıkış)"],
  ["credit", "Alacak (giriş)"],
  ["balance", "Bakiye"],
  ["valueDate", "Valör"],
  ["reference", "Dekont / referans"],
];

async function send(accountId: string, file: File, mode: "preview" | "import", mapping?: Mapping | null) {
  const body = new FormData();
  body.append("file", file);
  body.append("mode", mode);
  if (mapping) body.append("mapping", JSON.stringify(mapping));
  const response = await fetch(`/api/v1/bank-accounts/${accountId}/statements`, { method: "POST", body, cache: "no-store" });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json?.error?.message ?? `İstek başarısız (${response.status})`);
  return json;
}

/** Ekstre aktarımı: dosya → önizleme (sütun eşlemesi düzeltilebilir) → içe aktar. */
export function StatementImport({ accountId }: { accountId: string }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const choose = (f: File | null) => {
    setFile(f);
    setPreview(null);
    setResult(null);
    if (f)
      void run(async () => {
        const p: Preview = await send(accountId, f, "preview");
        setPreview(p);
        setMapping(p.mapping ?? { headerRow: 0 });
      });
  };

  const refresh = (m: Mapping) => {
    setMapping(m);
    if (file) void run(async () => setPreview(await send(accountId, file, "preview", m)));
  };

  const doImport = () =>
    run(async () => {
      const r: ImportResult = await send(accountId, file!, "import", mapping);
      setResult(r);
      setPreview(null);
      setFile(null);
      router.refresh();
    });

  const header = preview && mapping ? (preview.table[mapping.headerRow] ?? []) : [];
  const amountMapped = mapping && (mapping.amount !== undefined || (mapping.debit !== undefined && mapping.credit !== undefined));
  const canImport = !!preview && !!mapping && mapping.date !== undefined && amountMapped && preview.errorCount === 0 && preview.rowCount > 0;

  return (
    <div className="space-y-4 p-5">
      <div className="flex flex-wrap items-center gap-3">
        <input id="ekstre" type="file" accept=".xlsx,.csv,.txt" className="sr-only" disabled={busy} onChange={(e) => choose(e.target.files?.[0] ?? null)} />
        <label htmlFor="ekstre" className={cx(buttonClass.primary, "cursor-pointer", busy && "pointer-events-none opacity-50")}>
          {file ? "Başka dosya seç" : "Ekstre dosyası seç"}
        </label>
        <span className="text-xs text-ink-3">{file ? file.name : "Excel (.xlsx) veya CSV; en fazla 5 MB"}</span>
      </div>
      {error && <Alert>{error}</Alert>}
      {result && (
        <Alert tone={result.findings.some((f) => f.severity === "error") ? "warning" : "good"}>
          {result.imported} hareket aktarıldı{result.duplicates > 0 ? `, ${result.duplicates} mükerrer atlandı` : ""}.{" "}
          {result.findings.map((f) => f.message).join(" ")}
        </Alert>
      )}

      {preview && mapping && (
        <div className="space-y-4">
          {!preview.mapping && <Alert tone="warning">Başlık satırı tanınmadı; başlık satırını ve sütunları seçin.</Alert>}
          <div className="grid gap-3 rounded-lg border border-line p-3 sm:grid-cols-3">
            <Field label="Başlık satırı">
              <select value={mapping.headerRow} onChange={(e) => refresh({ headerRow: Number(e.target.value) })} className={cx(inputClass, "py-1.5 text-xs")}>
                {preview.table.map((r, i) => (
                  <option key={i} value={i}>
                    {i + 1}. satır: {r.filter(Boolean).slice(0, 4).join(" | ").slice(0, 60) || "(boş)"}
                  </option>
                ))}
              </select>
            </Field>
            {FIELD_LABELS.map(([field, label]) => (
              <Field key={field} label={label}>
                <select
                  value={mapping[field] ?? ""}
                  onChange={(e) => refresh({ ...mapping, [field]: e.target.value === "" ? undefined : Number(e.target.value) })}
                  className={cx(inputClass, "py-1.5 text-xs")}
                >
                  <option value="">—</option>
                  {header.map((h, i) => (
                    <option key={i} value={i}>
                      {h || `Sütun ${i + 1}`}
                    </option>
                  ))}
                </select>
              </Field>
            ))}
            <label className="flex items-center gap-2 self-end text-xs text-ink-2 sm:col-span-3">
              <input type="checkbox" checked={!!mapping.invertSign} onChange={(e) => refresh({ ...mapping, invertSign: e.target.checked })} />
              Tutar işaretini ters çevir (bankanız çıkışları artı gösteriyorsa)
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge>{preview.rowCount} hareket</Badge>
            {preview.balance?.status === "OK" && <Badge tone="good">Bakiye her satırda tutuyor</Badge>}
            {preview.balance?.status === "MISMATCH" && <Badge tone="critical">{preview.balance.mismatches.length} satırda bakiye tutmuyor</Badge>}
            {preview.balance?.status === "NO_BALANCE" && <Badge>Bakiye sütunu yok</Badge>}
            {preview.balance?.opening && (
              <span className="font-mono text-xs text-ink-2">
                açılış {formatMoney(preview.balance.opening)} → kapanış {formatMoney(preview.balance.closing)}
              </span>
            )}
            {preview.duplicates > 0 && <Badge tone="warning">{preview.duplicates} hareket daha önce aktarılmış</Badge>}
            {preview.skipped > 0 && <span className="text-xs text-ink-3">{preview.skipped} tarihsiz satır (ara toplam vb.) atlandı</span>}
          </div>
          {preview.errorCount > 0 && (
            <Alert>
              {preview.errorCount} satır okunamadı: {preview.errors.map((e) => `satır ${e.rowNo} (${e.message})`).join(", ")}
            </Alert>
          )}
          {preview.balance?.status === "MISMATCH" && (
            <Alert tone="warning">
              Bakiye tutmayan satırlar: {preview.balance.mismatches.map((m) => `satır ${m.rowNo} (beklenen ${formatMoney(m.expected)}, ekstrede ${formatMoney(m.actual)})`).join(", ")}. Aktarılabilir ama eksik/fazla hareket olabilir.
            </Alert>
          )}

          <div className="max-h-80 overflow-auto rounded-lg border border-line">
            <table className="w-full min-w-[560px] text-xs">
              <thead className="sticky top-0 bg-surface text-left text-ink-3">
                <tr className="border-b border-line">
                  <th className="px-3 py-2 font-medium">Satır</th>
                  <th className="px-2 py-2 font-medium">Tarih</th>
                  <th className="px-2 py-2 font-medium">Açıklama</th>
                  <th className="px-2 py-2 text-right font-medium">Tutar</th>
                  <th className="px-3 py-2 text-right font-medium">Bakiye</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line font-mono tabular-nums">
                {preview.rows.map((r) => (
                  <tr key={r.rowNo}>
                    <td className="px-3 py-1.5 text-ink-3">{r.rowNo}</td>
                    <td className="px-2 py-1.5">{r.txDate.split("-").reverse().join(".")}</td>
                    <td className="max-w-[20rem] truncate px-2 py-1.5 font-sans">{r.description}</td>
                    <td className={cx("px-2 py-1.5 text-right", Number(r.amount) < 0 ? "text-critical" : "text-ink")}>
                      {Number(r.amount) < 0 ? "−" : "+"}
                      {formatMoney(r.amount.replace("-", ""))}
                    </td>
                    <td className="px-3 py-1.5 text-right">{r.balance ? formatMoney(r.balance) : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.rowCount > preview.rows.length && <p className="text-xs text-ink-3">İlk {preview.rows.length} hareket gösteriliyor.</p>}
          <button type="button" className={buttonClass.primary} disabled={busy || !canImport} onClick={doImport}>
            {preview.rowCount} hareketi içe aktar
          </button>
        </div>
      )}
    </div>
  );
}
