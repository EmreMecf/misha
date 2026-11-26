# Güvenlik Mimarisi

Öncelik: veri güvenliği > performans > görsel tasarım.

## Kimlik doğrulama

- Parola: argon2id (`@node-rs/argon2`, varsayılan bellek/iterasyon parametreleri), en az 10 karakter.
- Oturum: 32 bayt rastgele token, istemcide çerez; veritabanında yalnızca SHA-256 özeti.
  Kayan süre 7 gün (kullanıldıkça uzar, en fazla 30 gün mutlak). Çıkışta ve parola değişiminde iptal.
- Giriş denemesi sınırı: e-posta başına 15 dakikada 5, IP başına 15 dakikada 20 başarısız deneme.
- Hata mesajı hangi alanın yanlış olduğunu söylemez ("e-posta veya parola hatalı").
- 2FA (TOTP): veri modeli Faz 9'da; o zamana kadar bilinen eksik.

## Yetkilendirme ve izolasyon

- RBAC: izin matrisi `src/server/tenancy/permissions.ts`, rol başına kaynak:işlem.
- Mükellef erişimi: `STAFF`, `TAXPAYER_USER` ve `READ_ONLY` yalnızca atandıkları mükellefleri görür.
- Kiracı izolasyonu iki katmanlı: servisler `organization_id` ile filtreler **ve** PostgreSQL RLS
  aynı kuralı zorlar. Testler (`tenantIsolation.integration.test.ts`) bağlam olmadan ve başka ofis
  bağlamıyla verinin görünmediğini doğrular.

## Web güvenliği

- CSRF: durum değiştiren isteklerde `Origin` kontrolü + `SameSite=Lax`.
- XSS: React kaçışı; `dangerouslySetInnerHTML` yasak (istisna gerekirse incelemeyle).
- Güvenlik başlıkları (`src/proxy.ts`): `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options: DENY`,
  `Permissions-Policy`. CSP Faz 9'da nonce tabanlı.
- SQL injection: yalnızca Prisma parametreli sorguları; ham SQL'de `$queryRaw` şablon parametreleri.

## Denetim ve KVKK

- `audit_logs`: giriş/çıkış, başarısız giriş, kayıt, mükellef/dönem/üye değişiklikleri. Yalnızca ekleme;
  RLS ile ofise kapalı. Parola, token ve tam kimlik numarası loglanmaz.
- Testlerde yalnızca sentetik veri; gerçek müşteri belgeleri depoya girmez (`.gitignore`).
- Sırlar yalnızca ortam değişkenlerinde; `.env.example` değersiz şablon.

## Bilinen eksikler (Faz 9'a kadar)

2FA, CSP nonce, genel hız sınırlayıcı, şifreli alan saklama (entegrasyon kimlik bilgileri gelmeden gerekmiyor),
yedek/geri yükleme testi.
