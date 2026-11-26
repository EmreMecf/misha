/**
 * Türkiye vergi kimlik numaraları.
 * VKN: 10 hane, GİB kontrol basamağı algoritması. TCKN: 11 hane, ilk hane 0 olamaz, 10. ve 11. hane kontrol.
 */

export function isValidVkn(value: string): boolean {
  if (!/^\d{10}$/.test(value)) return false;
  const d = [...value].map(Number);
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    const tmp = (d[i] + 9 - i) % 10;
    let v = (tmp * 2 ** (9 - i)) % 9;
    if (tmp !== 0 && v === 0) v = 9;
    sum += v;
  }
  return (10 - (sum % 10)) % 10 === d[9];
}

export function isValidTckn(value: string): boolean {
  if (!/^[1-9]\d{10}$/.test(value)) return false;
  const d = [...value].map(Number);
  const odd = d[0] + d[2] + d[4] + d[6] + d[8];
  const even = d[1] + d[3] + d[5] + d[7];
  const tenth = (((odd * 7 - even) % 10) + 10) % 10;
  if (tenth !== d[9]) return false;
  return d.slice(0, 10).reduce((s, n) => s + n, 0) % 10 === d[10];
}

/** Girilen numaranın türünü belirler; geçersizse null. Boşluklar yok sayılır. */
export function detectTaxId(raw: string): { type: "VKN" | "TCKN"; value: string } | null {
  const value = raw.replace(/\s+/g, "");
  if (isValidVkn(value)) return { type: "VKN", value };
  if (isValidTckn(value)) return { type: "TCKN", value };
  return null;
}
