# Test Stratejisi

| Katman | Araç | Komut | Veri |
|---|---|---|---|
| Unit | Vitest 4 | `npm test` | Saf fonksiyonlar (izin matrisi, doğrulayıcılar, VKN/TCKN, para) |
| Integration | Vitest + gerçek PostgreSQL | `npm run test:integration` | Docker PostgreSQL (`npm run db:up`), test başına yeni ofisler |
| E2E | Playwright (Faz 8) | — | Giriş → mükellef → fatura → onay → aktarım |
| Benchmark | Faz 9 | — | Sentetik / anonimleştirilmiş belge seti |

## Zorunlu testler

- Tenant izolasyonu: başka ofis bağlamında ve bağlamsız sorguda veri görünmez (RLS); servis katmanı
  başka ofisin kaynağına 404 döner.
- RBAC: her rolün izin matrisi; atanmamış mükellefe personel erişemez.
- Kimlik doğrulama: yanlış parola, kilit (hız sınırı), oturum süresi, çıkışta iptal, token özetinin saklanması.
- Her yeni modülün kritik kuralları (Faz 2+: UBL ayrıştırma, KDV sağlaması, borç/alacak dengesi, mükerrer).

## Kurallar

- Gerçek müşteri belgeleri test veya fixture'a kopyalanmaz.
- Başarısız test saklanmaz; neden araştırılır, düzeltilir, yeniden çalıştırılır.
- Ölçülmemiş doğruluk için başarı oranı iddia edilmez.
