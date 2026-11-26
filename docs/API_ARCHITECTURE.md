# API Mimarisi

- Yol: `/api/v1/<kaynak>`; Next.js route handler'ları (`src/app/api/v1/**/route.ts`).
- Gövde ve sorgu parametreleri Zod şemalarıyla doğrulanır; doğrulama hatası `422`.
- Hata biçimi (tek tip): `{ "error": { "code": "VALIDATION_ERROR", "message": "…", "details": … } }`.
- Kimlik: `HttpOnly` + `Secure` (üretimde) + `SameSite=Lax` oturum çerezi. Token düz metin olarak saklanmaz.
- CSRF: durum değiştiren isteklerde `Origin` başlığı uygulama kökenine eşit olmalı (`SameSite=Lax` + origin kontrolü).
- Yetki: her handler `requireContext(request, permission)` çağırır → kullanıcı, aktif ofis, rol, izin.
  Kiracı verisine yalnızca `withTenant(ctx, tx => …)` ile erişilir (RLS bağlamı).
- Sayfalama: `?cursor=&limit=` (en fazla 100).
- İdempotency (Faz 2+): yükleme ve aktarım uçları `Idempotency-Key` başlığı kabul eder.
- Hız sınırı: giriş ucunda e-posta + IP başına; diğer uçlar Faz 9'da genel sınırlayıcı.

## Faz 1 uçları

| Yöntem | Yol | İzin |
|---|---|---|
| POST | `/api/v1/auth/register` | herkese açık (yeni ofis + sahip kullanıcı) |
| POST | `/api/v1/auth/login` | herkese açık, hız sınırlı |
| POST | `/api/v1/auth/logout` | oturum |
| GET | `/api/v1/me` | oturum |
| GET/POST | `/api/v1/taxpayers` | `taxpayer:read` / `taxpayer:create` |
| GET/PATCH | `/api/v1/taxpayers/:id` | `taxpayer:read` / `taxpayer:update` |
| GET/POST | `/api/v1/taxpayers/:id/fiscal-periods` | `period:read` / `period:manage` |
| GET/POST | `/api/v1/members` | `member:read` / `member:manage` |
| GET | `/api/v1/audit-logs` | `audit:read` |
| GET | `/api/v1/health` | herkese açık (DB erişimi) |
