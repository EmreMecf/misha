import type { ReactNode } from "react";

export const cx = (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(" ");

export const buttonClass = {
  primary:
    "inline-flex items-center justify-center gap-2 rounded-lg bg-brand px-3.5 py-2 text-sm font-medium text-white transition hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50 dark:text-[#07261d]",
  secondary:
    "inline-flex items-center justify-center gap-2 rounded-lg border border-line bg-surface px-3.5 py-2 text-sm font-medium text-ink transition hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50",
  ghost:
    "inline-flex items-center justify-center gap-2 rounded-lg px-2.5 py-1.5 text-sm font-medium text-ink-2 transition hover:bg-surface-2 hover:text-ink disabled:opacity-50",
  danger:
    "inline-flex items-center justify-center gap-2 rounded-lg px-2.5 py-1.5 text-sm font-medium text-critical transition hover:bg-critical-soft disabled:opacity-50",
};

export const inputClass =
  "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none transition placeholder:text-ink-3 focus:border-brand focus:ring-2 focus:ring-brand/20";

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={cx("rounded-xl border border-line bg-surface", className)}>{children}</section>;
}

export function CardHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start gap-3 border-b border-line px-5 py-4">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        {description && <p className="mt-0.5 text-xs text-ink-3">{description}</p>}
      </div>
      {action && <div className="ml-auto shrink-0">{action}</div>}
    </div>
  );
}

export function PageHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end gap-4">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-ink">{title}</h1>
        {description && <p className="mt-1 text-sm text-ink-2">{description}</p>}
      </div>
      {action && <div className="ml-auto">{action}</div>}
    </header>
  );
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <p className="text-sm font-medium text-ink">{title}</p>
      {description && <p className="mt-1 max-w-sm text-xs text-ink-3">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

type Tone = "neutral" | "good" | "warning" | "critical" | "brand";
const TONES: Record<Tone, string> = {
  neutral: "bg-surface-2 text-ink-2",
  good: "bg-good-soft text-ink",
  warning: "bg-warning-soft text-ink",
  critical: "bg-critical-soft text-ink",
  brand: "bg-brand-soft text-brand-ink",
};
const DOTS: Record<Tone, string> = { neutral: "bg-ink-3", good: "bg-good", warning: "bg-warning", critical: "bg-critical", brand: "bg-brand" };

/** Durum rozeti: renk her zaman metin etiketiyle birlikte. */
export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={cx("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium", TONES[tone])}>
      <span className={cx("h-1.5 w-1.5 rounded-full", DOTS[tone])} aria-hidden="true" />
      {children}
    </span>
  );
}

export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-ink-2">{label}</span>
      {children}
      {error ? <span className="text-xs text-critical">{error}</span> : hint ? <span className="text-xs text-ink-3">{hint}</span> : null}
    </label>
  );
}

export function Alert({ tone = "critical", children }: { tone?: "critical" | "good" | "warning"; children: ReactNode }) {
  const cls = tone === "good" ? "bg-good-soft" : tone === "warning" ? "bg-warning-soft" : "bg-critical-soft";
  return (
    <p role={tone === "critical" ? "alert" : "status"} className={cx("rounded-lg px-3 py-2 text-sm text-ink", cls)}>
      {children}
    </p>
  );
}

export const formatDate = (d: Date | string) => new Date(d).toLocaleDateString("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
export const formatDateTime = (d: Date | string) =>
  new Date(d).toLocaleString("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
