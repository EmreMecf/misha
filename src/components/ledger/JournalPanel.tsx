"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { formatMoney } from "@/components/documents/format";
import { Alert, Badge, buttonClass, CardHeader, cx, EmptyState, Field, formatDate, inputClass } from "@/components/ui/primitives";
import { api } from "@/lib/apiClient";

export interface JournalLineView {
  id: string;
  lineNo: number;
  kind: string;
  accountId: string | null;
  proposedAccountId: string | null;
  accountLabel: string | null;
  debit: string;
  credit: string;
  description: string;
  source: string;
  reason: string;
}

export interface JournalEntryView {
  id: string;
  status: "DRAFT" | "POSTED" | "REVERSED";
  entryNo: number | null;
  entryDate: string;
  description: string;
  version: number;
  reversalOfId: string | null;
  findings: Array<{ code: string; severity: "error" | "warning"; message: string }>;
  lines: JournalLineView[];
}

export interface AccountOption {
  id: string;
  code: string;
  name: string;
}

const SOURCE_LABELS: Record<string, string> = {
  POSTING_RULE: "Kesin kural",
  HISTORY: "Geçmiş onaylar",
  ROLE_MAPPING: "Hesap rolü",
  UNRESOLVED: "Seçilmedi",
  USER: "Ters kayıt",
};

const KIND_LABELS: Record<string, string> = {
  MAIN: "Ana satır",
  VAT: "KDV",
  COUNTERPARTY: "Cari",
  WITHHOLDING: "Tevkifat",
  OTHER_TAX: "Diğer vergi",
  MANUAL: "Elle",
};

const sum = (xs: string[]) => xs.reduce((s, x) => s + Math.round(Number(x) * 100), 0);

/** Belgenin muhasebe fişi: öneri → hesap düzeltme → kesinleştir; kesin fiş için ters kayıt. */
export function JournalPanel({
  documentId,
  taxpayerId,
  documentStatus,
  entries,
  accounts,
  hasChart,
  canEdit,
  canPost,
  canManageChart,
}: {
  documentId: string;
  taxpayerId: string;
  documentStatus: string;
  entries: JournalEntryView[];
  accounts: AccountOption[];
  hasChart: boolean;
  canEdit: boolean;
  canPost: boolean;
  canManageChart: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveRule, setSaveRule] = useState(true);
  const [reversing, setReversing] = useState(false);

  const active = entries.find((e) => !e.reversalOfId && e.status !== "REVERSED");
  const history = entries.filter((e) => e !== active);

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

  const propose = () => run(() => api(`/api/v1/documents/${documentId}/journal`, { method: "POST" }));
  const initChart = () =>
    run(async () => {
      await api(`/api/v1/taxpayers/${taxpayerId}/ledger`, { method: "POST" });
      await api(`/api/v1/documents/${documentId}/journal`, { method: "POST" });
    });

  if (!hasChart) {
    return (
      <>
        <CardHeader title="Muhasebe fişi" />
        <EmptyState
          title="Mükellefin hesap planı yok"
          description={canManageChart ? "TDHP ana hesaplarıyla başlatıp fiş önerisi oluşturabilirsiniz. Alt hesapları sonra açabilirsiniz." : "Hesap planını mali müşavir başlatmalı."}
          action={
            canManageChart ? (
              <button type="button" className={buttonClass.primary} disabled={busy} onClick={initChart}>
                Hesap planını başlat ve fiş öner
              </button>
            ) : undefined
          }
        />
        {error && <div className="px-5 pb-4"><Alert>{error}</Alert></div>}
      </>
    );
  }

  if (!active) {
    return (
      <>
        <CardHeader title="Muhasebe fişi" />
        <EmptyState
          title="Fiş önerisi yok"
          description={documentStatus === "ACCOUNTING_PENDING" ? "Faturadan kural motoruyla öneri oluşturun." : "Belge kontrol edildikten sonra fiş önerilir."}
          action={
            canEdit && documentStatus === "ACCOUNTING_PENDING" ? (
              <button type="button" className={buttonClass.primary} disabled={busy} onClick={propose}>
                Fiş öner
              </button>
            ) : undefined
          }
        />
        {error && <div className="px-5 pb-4"><Alert>{error}</Alert></div>}
        <EntryHistory entries={history} />
      </>
    );
  }

  const draft = active.status === "DRAFT";
  const debit = sum(active.lines.map((l) => l.debit));
  const credit = sum(active.lines.map((l) => l.credit));
  const missing = active.lines.filter((l) => !l.accountId).length;
  const mainChanged = active.lines.some((l) => l.kind === "MAIN" && l.accountId && l.accountId !== l.proposedAccountId);
  // Hesap eksikliği canlı hesaplanır; öneri anındaki ACCOUNT_MISSING bulgusu gösterilmez
  const findings = active.findings.filter((f) => f.code !== "ACCOUNT_MISSING");
  const blocking = findings.filter((f) => f.severity === "error");
  const postable = draft && debit === credit && debit > 0 && missing === 0 && blocking.length === 0;

  const changeAccount = (lineId: string, accountId: string) =>
    run(() => api(`/api/v1/journal/${active.id}`, { method: "PATCH", body: { version: active.version, lines: [{ id: lineId, accountId: accountId || null }] } }));

  const post = () => run(() => api(`/api/v1/journal/${active.id}`, { body: { action: "post", version: active.version, saveRule: mainChanged && saveRule } }));

  const reverse = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const reason = String(new FormData(event.currentTarget).get("reason") ?? "");
    void run(async () => {
      await api(`/api/v1/journal/${active.id}`, { body: { action: "reverse", reason } });
      setReversing(false);
    });
  };

  return (
    <>
      <CardHeader
        title={draft ? "Fiş önerisi" : `Yevmiye ${active.entryNo}`}
        description={`${formatDate(active.entryDate)} · ${active.description}`}
        action={draft ? <Badge tone="brand">Taslak</Badge> : <Badge tone="good">Kesinleşti</Badge>}
      />
      {draft && (missing > 0 || findings.length > 0) && (
        <ul className="space-y-1 border-b border-line px-5 py-3">
          {missing > 0 && (
            <li className="flex items-start gap-2 text-sm">
              <Badge tone="critical">Hata</Badge>
              <span className="text-ink">{missing} satırın hesabı seçilmeli</span>
            </li>
          )}
          {findings.map((f, i) => (
            <li key={i} className="flex items-start gap-2 text-sm">
              <Badge tone={f.severity === "error" ? "critical" : "warning"}>{f.severity === "error" ? "Hata" : "Uyarı"}</Badge>
              <span className="text-ink">{f.message}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="text-left text-xs text-ink-3">
            <tr className="border-b border-line">
              <th className="px-5 py-2 font-medium">Hesap</th>
              <th className="px-2 py-2 font-medium">Açıklama</th>
              <th className="px-2 py-2 text-right font-medium">Borç</th>
              <th className="px-2 py-2 text-right font-medium">Alacak</th>
              <th className="px-5 py-2 font-medium">Gerekçe</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {active.lines.map((l) => (
              <tr key={l.id} className="align-top">
                <td className="w-[34%] px-5 py-2">
                  {draft && canEdit ? (
                    <select
                      aria-label={`${l.lineNo}. satır hesabı`}
                      value={l.accountId ?? ""}
                      disabled={busy}
                      onChange={(e) => changeAccount(l.id, e.target.value)}
                      className={cx(inputClass, "py-1.5 font-mono text-xs", !l.accountId && "border-critical")}
                    >
                      <option value="">— Hesap seçin —</option>
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.code} {a.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="font-mono text-xs text-ink">{l.accountLabel ?? "—"}</span>
                  )}
                  <span className="mt-1 block text-[11px] text-ink-3">{KIND_LABELS[l.kind] ?? l.kind}</span>
                </td>
                <td className="px-2 py-2 text-xs text-ink-2">{l.description}</td>
                <td className="px-2 py-2 text-right font-mono text-xs tabular-nums">{Number(l.debit) > 0 ? formatMoney(l.debit) : ""}</td>
                <td className="px-2 py-2 text-right font-mono text-xs tabular-nums">{Number(l.credit) > 0 ? formatMoney(l.credit) : ""}</td>
                <td className="px-5 py-2 text-xs text-ink-2">
                  {l.accountId !== l.proposedAccountId ? (
                    <>
                      <Badge tone="brand">Kullanıcı seçti</Badge>
                      <span className="mt-1 block text-ink-3">Öneri ({SOURCE_LABELS[l.source] ?? l.source}): {l.reason}</span>
                    </>
                  ) : (
                    <>
                      <Badge tone={l.source === "UNRESOLVED" ? "critical" : "neutral"}>{SOURCE_LABELS[l.source] ?? l.source}</Badge>
                      <span className="mt-1 block">{l.reason}</span>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-line font-mono text-xs tabular-nums">
              <td className="px-5 py-2 font-sans text-xs font-medium text-ink-2" colSpan={2}>
                Toplam {debit === credit ? <Badge tone="good">Dengeli</Badge> : <Badge tone="critical">Dengesiz</Badge>}
              </td>
              <td className="px-2 py-2 text-right font-semibold">{formatMoney((debit / 100).toFixed(2))}</td>
              <td className="px-2 py-2 text-right font-semibold">{formatMoney((credit / 100).toFixed(2))}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="space-y-3 border-t border-line px-5 py-4">
        {draft && (
          <>
            {mainChanged && canPost && (
              <label className="flex items-start gap-2 text-sm text-ink">
                <input type="checkbox" checked={saveRule} onChange={(e) => setSaveRule(e.target.checked)} className="mt-0.5" />
                <span>
                  Bu karşı taraf için kural olarak kaydet
                  <span className="block text-xs text-ink-3">Sonraki faturalarında ana satır seçtiğiniz hesapla önerilir (yalnızca bu mükellef).</span>
                </span>
              </label>
            )}
            <div className="flex flex-wrap gap-2">
              {canPost && (
                <button type="button" className={buttonClass.primary} disabled={busy || !postable} onClick={post}>
                  Fişi kesinleştir
                </button>
              )}
              {canEdit && (
                <button type="button" className={buttonClass.secondary} disabled={busy} onClick={propose}>
                  Yeniden öner
                </button>
              )}
            </div>
            {!canPost && <p className="text-xs text-ink-3">Fişi mali müşavir kesinleştirir.</p>}
            {canPost && !postable && (
              <p className="text-xs text-ink-3">Kesinleştirmek için tüm satırların hesabı seçilmiş ve fiş dengeli olmalı.</p>
            )}
          </>
        )}
        {!draft && canPost && !reversing && (
          <button type="button" className={buttonClass.danger} disabled={busy} onClick={() => setReversing(true)}>
            Ters kayıtla iptal et
          </button>
        )}
        {reversing && (
          <form onSubmit={reverse} className="space-y-2 rounded-lg border border-line p-3">
            <Field label="İptal nedeni" hint="Ters kayıt aynı dönemde kesinleşir; belge yeniden muhasebeleşmeyi bekler.">
              <input name="reason" required minLength={3} maxLength={300} className={inputClass} autoFocus />
            </Field>
            <div className="flex gap-2">
              <button type="submit" className={buttonClass.primary} disabled={busy}>
                Ters kaydı oluştur
              </button>
              <button type="button" className={buttonClass.ghost} disabled={busy} onClick={() => setReversing(false)}>
                Vazgeç
              </button>
            </div>
          </form>
        )}
        {error && <Alert>{error}</Alert>}
      </div>
      <EntryHistory entries={history} />
    </>
  );
}

function EntryHistory({ entries }: { entries: JournalEntryView[] }) {
  if (entries.length === 0) return null;
  return (
    <details className="border-t border-line px-5 py-3">
      <summary className="cursor-pointer text-xs font-medium text-ink-2">Önceki fişler ({entries.length})</summary>
      <ul className="mt-2 space-y-3">
        {entries.map((e) => (
          <li key={e.id} className="text-xs">
            <p className="font-medium text-ink">
              Yevmiye {e.entryNo ?? "—"} · {e.status === "REVERSED" ? "İptal edildi" : e.reversalOfId ? "Ters kayıt" : e.status} · {e.description}
            </p>
            <ul className="mt-1 font-mono text-ink-2">
              {e.lines.map((l) => (
                <li key={l.id} className="flex justify-between gap-4">
                  <span>{l.accountLabel ?? "—"}</span>
                  <span>{Number(l.debit) > 0 ? `B ${formatMoney(l.debit)}` : `A ${formatMoney(l.credit)}`}</span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </details>
  );
}
