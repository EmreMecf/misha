/**
 * Parasal değer gösterimi. Decimal (Prisma) veya metin alır; float'a çevirmeden
 * binlik ayırıcı ve virgüllü kuruş ekler (tr-TR).
 */
export function formatMoney(value: { toFixed(n: number): string } | string | null | undefined, currency?: string | null) {
  if (value == null) return "—";
  const fixed = typeof value === "string" ? value : value.toFixed(2);
  const negative = fixed.startsWith("-");
  const [int, frac = "00"] = (negative ? fixed.slice(1) : fixed).split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${negative ? "-" : ""}${grouped},${frac.padEnd(2, "0").slice(0, 2)}${currency ? ` ${currency}` : ""}`;
}

/** Oran gösterimi: "20.00" -> "%20", "1.50" -> "%1,5" */
export function formatRate(value: { toString(): string } | string | null | undefined) {
  if (value == null) return "—";
  return `%${trimDecimals(String(value))}`;
}

export function formatQuantity(value: { toString(): string }) {
  return trimDecimals(String(value));
}

/** Ondalık kısmın sondaki sıfırlarını atar: "1.5000" -> "1,5", "10" -> "10". */
function trimDecimals(s: string) {
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "").replace(".", ",") : s;
}
