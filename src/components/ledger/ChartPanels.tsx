"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";
import { Alert, Badge, buttonClass, CardHeader, cx, EmptyState, Field, inputClass } from "@/components/ui/primitives";
import { api } from "@/lib/apiClient";

function useRun() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      router.refresh();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

export interface AccountRow {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  isPostable: boolean;
}

export function InitChart({ taxpayerId, canManage }: { taxpayerId: string; canManage: boolean }) {
  const { busy, error, run } = useRun();
  return (
    <EmptyState
      title="Hesap planı yok"
      description={
        canManage
          ? "Tekdüzen Hesap Planı ana hesaplarıyla başlatın; alt hesapları (ör. 320.01) sonra açarsınız. Varsayılan rol eşlemeleri (191, 320, 391, 600…) birlikte gelir."
          : "Hesap planını mali müşavir başlatmalı."
      }
      action={
        canManage ? (
          <div className="space-y-2">
            <button type="button" className={buttonClass.primary} disabled={busy} onClick={() => run(() => api(`/api/v1/taxpayers/${taxpayerId}/ledger`, { method: "POST" }))}>
              TDHP şablonuyla başlat
            </button>
            {error && <Alert>{error}</Alert>}
          </div>
        ) : undefined
      }
    />
  );
}

export function RoleMappings({
  taxpayerId,
  roles,
  accounts,
  canManage,
}: {
  taxpayerId: string;
  roles: Array<{ role: string; label: string; accountId: string | null }>;
  accounts: AccountRow[];
  canManage: boolean;
}) {
  const { busy, error, run } = useRun();
  const options = accounts.filter((a) => a.isActive && a.isPostable);
  return (
    <>
      <CardHeader title="Hesap rolleri" description="Kural motoru fiş satırlarını bu eşlemeyle hesaba çevirir. Satıcıya özel kural ve geçmiş onaylar bunun önüne geçer." />
      <ul className="divide-y divide-line">
        {roles.map((r) => (
          <li key={r.role} className="grid gap-2 px-5 py-2.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] sm:items-center">
            <span className="text-sm text-ink">
              {r.label}
              {!r.accountId && (
                <span className="ml-2">
                  <Badge tone="warning">Seçilmedi</Badge>
                </span>
              )}
            </span>
            <select
              aria-label={r.label}
              value={r.accountId ?? ""}
              disabled={!canManage || busy}
              onChange={(e) => run(() => api(`/api/v1/taxpayers/${taxpayerId}/ledger/roles`, { method: "PUT", body: { role: r.role, accountId: e.target.value || null } }))}
              className={cx(inputClass, "py-1.5 font-mono text-xs")}
            >
              <option value="">— Seçilmedi —</option>
              {options.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} {a.name}
                </option>
              ))}
            </select>
          </li>
        ))}
      </ul>
      {error && <div className="px-5 pb-4"><Alert>{error}</Alert></div>}
    </>
  );
}

export function AccountList({ taxpayerId, accounts, canManage }: { taxpayerId: string; accounts: AccountRow[]; canManage: boolean }) {
  const { busy, error, run } = useRun();
  const [query, setQuery] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const visible = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("tr");
    return accounts.filter((a) => (showInactive || a.isActive) && (!q || a.code.startsWith(q) || a.name.toLocaleLowerCase("tr").includes(q)));
  }, [accounts, query, showInactive]);

  const create = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    void run(() => api(`/api/v1/taxpayers/${taxpayerId}/ledger/accounts`, { body: { code: data.get("code"), name: data.get("name") } })).then((ok) => ok && form.reset());
  };

  return (
    <>
      <CardHeader title="Hesaplar" description={`${accounts.filter((a) => a.isActive).length} aktif hesap`} />
      {canManage && (
        <form onSubmit={create} className="grid items-end gap-3 border-b border-line px-5 py-4 sm:grid-cols-[8rem_minmax(0,1fr)_auto]">
          <Field label="Kod" hint="Ör. 770.01">
            <input name="code" required className={cx(inputClass, "font-mono")} placeholder="770.01" />
          </Field>
          <Field label="Hesap adı">
            <input name="name" required minLength={2} className={inputClass} placeholder="Kira giderleri" />
          </Field>
          <button type="submit" className={buttonClass.primary} disabled={busy}>
            Alt hesap aç
          </button>
        </form>
      )}
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Kod veya ad ara"
          aria-label="Hesap ara"
          className={cx(inputClass, "max-w-xs py-1.5")}
        />
        <label className="flex items-center gap-2 text-xs text-ink-2">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          Pasifleri göster
        </label>
      </div>
      {error && <div className="px-5 pt-3"><Alert>{error}</Alert></div>}
      <ul className="max-h-[60vh] divide-y divide-line overflow-y-auto">
        {visible.map((a) => {
          const depth = a.code.split(".").length - 1;
          return (
            <li key={a.id} className="flex items-center gap-3 px-5 py-1.5 text-sm" style={{ paddingLeft: `${1.25 + depth * 1.25}rem` }}>
              <span className="w-24 shrink-0 font-mono text-xs text-ink-2">{a.code}</span>
              <span className={cx("min-w-0 flex-1 truncate", a.isActive ? "text-ink" : "text-ink-3 line-through")}>{a.name}</span>
              {!a.isPostable && <Badge>Ana hesap</Badge>}
              {canManage && (
                <button
                  type="button"
                  className={buttonClass.ghost}
                  disabled={busy}
                  onClick={() => run(() => api(`/api/v1/taxpayers/${taxpayerId}/ledger/accounts/${a.id}`, { method: "PATCH", body: { isActive: !a.isActive } }))}
                >
                  {a.isActive ? "Pasifleştir" : "Etkinleştir"}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}

export function PostingRules({
  taxpayerId,
  rules,
  canManage,
}: {
  taxpayerId: string;
  rules: Array<{ id: string; counterpartyTaxId: string; counterpartyName: string | null; direction: "PURCHASE" | "SALE"; account: string; isActive: boolean }>;
  canManage: boolean;
}) {
  const { busy, error, run } = useRun();
  return (
    <>
      <CardHeader title="Öğrenilen kurallar" description="Fiş kesinleştirilirken önerilen hesap değiştirilip kural olarak kaydedildiğinde oluşur. Yalnızca bu mükellefe uygulanır." />
      {rules.length === 0 ? (
        <EmptyState title="Kural yok" />
      ) : (
        <ul className="divide-y divide-line">
          {rules.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-2.5 text-sm">
              <div className="min-w-0 flex-1">
                <p className={cx("truncate", r.isActive ? "text-ink" : "text-ink-3 line-through")}>{r.counterpartyName ?? r.counterpartyTaxId}</p>
                <p className="font-mono text-xs text-ink-3">
                  {r.counterpartyTaxId} · {r.direction === "PURCHASE" ? "alış" : "satış"} → {r.account}
                </p>
              </div>
              {canManage && (
                <button
                  type="button"
                  className={buttonClass.ghost}
                  disabled={busy}
                  onClick={() => run(() => api(`/api/v1/taxpayers/${taxpayerId}/ledger/rules/${r.id}`, { method: "PATCH", body: { isActive: !r.isActive } }))}
                >
                  {r.isActive ? "Kapat" : "Aç"}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {error && <div className="px-5 pb-4"><Alert>{error}</Alert></div>}
    </>
  );
}
