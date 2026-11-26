"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { api } from "@/lib/apiClient";
import { cx } from "@/components/ui/primitives";

export interface ShellData {
  fullName: string;
  email: string;
  roleLabel: string;
  organizationId: string;
  organizations: Array<{ id: string; name: string }>;
  nav: Array<{ href: string; label: string }>;
}

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

/** Uygulama kabuğu: kenar çubuğu (masaüstünde sabit, mobilde çekmece) + üst bar. */
export function AppShell({ data, children }: { data: ShellData; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const current = data.organizations.find((o) => o.id === data.organizationId);

  const switchOrg = async (organizationId: string) => {
    setBusy(true);
    try {
      await api("/api/v1/auth/switch-organization", { body: { organizationId } });
      router.replace("/");
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    setBusy(true);
    await api("/api/v1/auth/logout", { method: "POST" }).catch(() => undefined);
    router.replace("/giris");
    router.refresh();
  };

  const nav = (
    <nav aria-label="Ana menü" className="flex flex-col gap-0.5 px-3">
      {data.nav.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          onClick={() => setOpen(false)}
          aria-current={isActive(pathname, item.href) ? "page" : undefined}
          className={cx(
            "rounded-lg px-3 py-2 text-sm transition",
            isActive(pathname, item.href) ? "bg-brand-soft font-medium text-brand-ink" : "text-ink-2 hover:bg-surface-2 hover:text-ink",
          )}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );

  const sidebar = (
    <div className="flex h-full flex-col gap-6 py-5">
      <Link href="/" className="flex items-center gap-2.5 px-6">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand font-mono text-xs font-semibold text-white dark:text-[#07261d]">M</span>
        <span className="font-semibold tracking-tight text-ink">MİHSAP</span>
      </Link>
      {data.organizations.length > 1 ? (
        <label className="px-6">
          <span className="sr-only">Aktif ofis</span>
          <select
            value={data.organizationId}
            disabled={busy}
            onChange={(e) => switchOrg(e.target.value)}
            className="w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm text-ink"
          >
            {data.organizations.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <p className="truncate px-6 text-sm font-medium text-ink-2" title={current?.name}>
          {current?.name}
        </p>
      )}
      {nav}
      <div className="mt-auto border-t border-line px-6 pt-4">
        <p className="truncate text-sm font-medium text-ink">{data.fullName}</p>
        <p className="truncate text-xs text-ink-3">
          {data.roleLabel} · {data.email}
        </p>
        <div className="mt-3 flex gap-2">
          <Link href="/hesabim" className="text-xs font-medium text-ink-2 hover:text-ink">
            Hesabım
          </Link>
          <button type="button" onClick={logout} disabled={busy} className="text-xs font-medium text-ink-2 hover:text-critical">
            Çıkış yap
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen flex-1">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 border-r border-line bg-surface lg:block">{sidebar}</aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menü">
          <button type="button" aria-label="Menüyü kapat" className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside className="relative h-full w-72 max-w-[85vw] border-r border-line bg-surface">{sidebar}</aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-12 items-center gap-3 border-b border-line bg-surface px-4 lg:hidden">
          <button type="button" aria-label="Menüyü aç" onClick={() => setOpen(true)} className="rounded-md px-2 py-1 text-sm text-ink-2 hover:bg-surface-2">
            ☰
          </button>
          <span className="truncate text-sm font-medium text-ink">{current?.name ?? "MİHSAP"}</span>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-8 sm:py-8">{children}</main>
      </div>
    </div>
  );
}
