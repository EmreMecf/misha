// Sentetik test verisi üreticileri. Gerçek kişi/şirket kimlik numarası kullanılmaz.

/** 9 haneli önekten geçerli bir VKN üretir (kontrol basamağı hesaplanır). */
export function makeVkn(prefix9: string): string {
  const d = [...prefix9].map(Number);
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    const tmp = (d[i] + 9 - i) % 10;
    let v = (tmp * 2 ** (9 - i)) % 9;
    if (tmp !== 0 && v === 0) v = 9;
    sum += v;
  }
  return prefix9 + String((10 - (sum % 10)) % 10);
}

/** 9 haneli önekten (ilk hane 1-9) geçerli bir TCKN üretir. */
export function makeTckn(prefix9: string): string {
  const d = [...prefix9].map(Number);
  const odd = d[0] + d[2] + d[4] + d[6] + d[8];
  const even = d[1] + d[3] + d[5] + d[7];
  const tenth = (((odd * 7 - even) % 10) + 10) % 10;
  const eleventh = (d.reduce((s, n) => s + n, 0) + tenth) % 10;
  return `${prefix9}${tenth}${eleventh}`;
}

/** Testler arası çakışmasın diye benzersiz e-posta. */
export const uniqueEmail = (label: string) => `${label}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}@test.mihsap.local`;

/** Benzersiz geçerli VKN (zaman damgasından). */
export const uniqueVkn = () => makeVkn(String(Date.now() * 1000 + Math.floor(Math.random() * 1000)).slice(-9).padStart(9, "1"));
