export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand font-mono text-sm font-semibold text-white dark:text-[#07261d]">M</span>
          <div>
            <p className="font-semibold tracking-tight text-ink">MİHSAP</p>
            <p className="text-xs text-ink-3">Muhasebe otomasyon platformu</p>
          </div>
        </div>
        {children}
      </div>
    </main>
  );
}
