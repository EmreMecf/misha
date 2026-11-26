"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { formatMoney } from "@/components/documents/format";
import { Alert, Badge, buttonClass, cx, EmptyState, inputClass } from "@/components/ui/primitives";
import { api } from "@/lib/apiClient";

export type SuggestionView =
  | { kind: "INVOICE"; documentId: string; invoiceNo: string; counterpartyName: string | null; confidence: "high" | "medium" | "low"; ambiguous: boolean; reasons: string[] }
  | { kind: "RULE"; ruleId: string; account: { id: string; code: string; name: string }; reasons: string[] };

export interface TransactionView {
  id: string;
  txDate: string;
  description: string;
  reference: string | null;
  amount: string;
  balance: string | null;
  status: "UNMATCHED" | "MATCHED" | "IGNORED";
  matchReason: string | null;
  entryNo: number | null;
  matchedDocument: { id: string; label: string } | null;
  suggestion: SuggestionView | null;
}

const CONFIDENCE = { high: { label: "Güçlü eşleşme", tone: "good" }, medium: { label: "Olası eşleşme", tone: "brand" }, low: { label: "Zayıf eşleşme", tone: "warning" } } as const;

/** Description'dan kural için anlamlı ilk sözcükler (rakam/kod içermeyen) */
const keywordHint = (description: string) =>
  description
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !/\d/.test(w))
    .slice(0, 2)
    .join(" ")
    .toLocaleUpperCase("tr");

export function TransactionList({
  transactions,
  accounts,
  canPost,
  canImport,
}: {
  transactions: TransactionView[];
  accounts: Array<{ id: string; code: string; name: string }>;
  canPost: boolean;
  canImport: boolean;
}) {
  if (transactions.length === 0) return <EmptyState title="Hareket yok" description="Ekstre aktarınca hareketler burada eşleştirilir." />;
  return (
    <ul className="divide-y divide-line">
      {transactions.map((t) => (
        <TransactionRow key={t.id} t={t} accounts={accounts} canPost={canPost} canImport={canImport} />
      ))}
    </ul>
  );
}

function TransactionRow({ t, accounts, canPost, canImport }: { t: TransactionView; accounts: Array<{ id: string; code: string; name: string }>; canPost: boolean; canImport: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [classifying, setClassifying] = useState(false);
  const negative = Number(t.amount) < 0;

  const act = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/v1/bank-transactions/${t.id}`, { body });
      setClassifying(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const classify = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void act({ action: "classify", accountId: data.get("accountId"), saveKeyword: data.get("saveRule") ? String(data.get("keyword") ?? "") : undefined });
  };

  return (
    <li className="px-5 py-3 text-sm">
      <div className="grid gap-x-4 gap-y-1 sm:grid-cols-[6rem_minmax(0,1fr)_auto]">
        <span className="font-mono text-xs text-ink-3">{t.txDate.split("-").reverse().join(".")}</span>
        <div className="min-w-0">
          <p className="break-words text-ink">{t.description}</p>
          {t.reference && <p className="font-mono text-[11px] text-ink-3">Ref. {t.reference}</p>}
        </div>
        <div className="text-right">
          <p className={cx("font-mono tabular-nums", negative ? "text-critical" : "text-ink")}>
            {negative ? "−" : "+"}
            {formatMoney(t.amount.replace("-", ""))}
          </p>
          {t.balance && <p className="font-mono text-[11px] text-ink-3">bakiye {formatMoney(t.balance)}</p>}
        </div>
      </div>

      <div className="mt-2 sm:ml-[7rem]">
        {t.status === "MATCHED" && (
          <p className="flex flex-wrap items-center gap-2 text-xs text-ink-2">
            <Badge tone="good">Eşleşti</Badge>
            <span>{t.matchReason}</span>
            {t.entryNo && <span className="font-mono">· yevmiye {t.entryNo}</span>}
            {t.matchedDocument && (
              <Link href={`/belgeler/${t.matchedDocument.id}`} className="font-medium text-brand-ink hover:underline">
                {t.matchedDocument.label} →
              </Link>
            )}
          </p>
        )}
        {t.status === "IGNORED" && (
          <p className="flex flex-wrap items-center gap-2 text-xs text-ink-2">
            <Badge>Yok sayıldı</Badge>
            {canImport && (
              <button type="button" className={buttonClass.ghost} disabled={busy} onClick={() => act({ action: "unignore" })}>
                Geri al
              </button>
            )}
          </p>
        )}
        {t.status === "UNMATCHED" && (
          <div className="space-y-2">
            {t.suggestion?.kind === "INVOICE" && (
              <div className="rounded-lg border border-line bg-surface-2 p-3">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <Badge tone={CONFIDENCE[t.suggestion.confidence].tone}>{CONFIDENCE[t.suggestion.confidence].label}</Badge>
                  <span className="font-medium text-ink">
                    Fatura {t.suggestion.invoiceNo}
                    {t.suggestion.counterpartyName ? ` — ${t.suggestion.counterpartyName}` : ""}
                  </span>
                  <Link href={`/belgeler/${t.suggestion.documentId}`} className="text-brand-ink hover:underline">
                    görüntüle
                  </Link>
                </div>
                <ul className="mt-1 list-inside list-disc text-xs text-ink-2">
                  {t.suggestion.reasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
                {canPost && (
                  <button type="button" className={cx(buttonClass.primary, "mt-2")} disabled={busy} onClick={() => act({ action: "match", documentId: (t.suggestion as { documentId: string }).documentId })}>
                    Eşleştir ve fişi kes
                  </button>
                )}
              </div>
            )}
            {t.suggestion?.kind === "RULE" && (
              <div className="rounded-lg border border-line bg-surface-2 p-3 text-xs">
                <p className="font-medium text-ink">
                  Öneri: {t.suggestion.account.code} {t.suggestion.account.name}
                </p>
                <p className="mt-1 text-ink-2">{t.suggestion.reasons.join(" ")}</p>
                {canPost && (
                  <button
                    type="button"
                    className={cx(buttonClass.primary, "mt-2")}
                    disabled={busy}
                    onClick={() => {
                      const s = t.suggestion as { ruleId: string; account: { id: string } };
                      void act({ action: "classify", accountId: s.account.id, ruleId: s.ruleId });
                    }}
                  >
                    Onayla ve fişi kes
                  </button>
                )}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              {canPost && !classifying && (
                <button type="button" className={buttonClass.secondary} disabled={busy} onClick={() => setClassifying(true)}>
                  Hesaba işle
                </button>
              )}
              {canImport && (
                <button type="button" className={buttonClass.ghost} disabled={busy} onClick={() => act({ action: "ignore" })}>
                  Yok say
                </button>
              )}
            </div>
            {classifying && (
              <form onSubmit={classify} className="grid gap-2 rounded-lg border border-line p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <select name="accountId" required className={cx(inputClass, "py-1.5 font-mono text-xs")} aria-label="Karşı hesap">
                  <option value="">— Karşı hesap —</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} {a.name}
                    </option>
                  ))}
                </select>
                <input name="keyword" defaultValue={keywordHint(t.description)} className={cx(inputClass, "py-1.5 text-xs")} aria-label="Kural anahtar kelimesi" />
                <label className="flex items-center gap-2 text-xs text-ink-2 sm:col-span-2">
                  <input type="checkbox" name="saveRule" defaultChecked />
                  Açıklamasında bu kelime geçen sonraki {negative ? "çıkışlar" : "girişler"} için kural olarak kaydet
                </label>
                <div className="flex gap-2 sm:col-span-2">
                  <button type="submit" className={buttonClass.primary} disabled={busy}>
                    Fişi kes
                  </button>
                  <button type="button" className={buttonClass.ghost} onClick={() => setClassifying(false)}>
                    Vazgeç
                  </button>
                </div>
              </form>
            )}
          </div>
        )}
        {error && (
          <div className="mt-2">
            <Alert>{error}</Alert>
          </div>
        )}
      </div>
    </li>
  );
}
