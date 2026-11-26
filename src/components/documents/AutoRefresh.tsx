"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** İşlenen belge varken sayfayı birkaç saniyede bir tazeler (en fazla ~1 dakika). */
export function AutoRefresh({ intervalMs = 2500, maxTicks = 24 }: { intervalMs?: number; maxTicks?: number }) {
  const router = useRouter();
  useEffect(() => {
    let ticks = 0;
    const timer = setInterval(() => {
      ticks += 1;
      if (ticks > maxTicks) return clearInterval(timer);
      router.refresh();
    }, intervalMs);
    return () => clearInterval(timer);
  }, [router, intervalMs, maxTicks]);
  return (
    <p role="status" className="border-b border-line bg-surface-2 px-5 py-2 text-xs text-ink-2">
      Belgeler işleniyor, sayfa kendiliğinden güncellenecek…
    </p>
  );
}
