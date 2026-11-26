@AGENTS.md

# MİHSAP — AI destekli muhasebe otomasyonu

Mihsap benzeri, bağımsız, çok kiracılı muhasebe otomasyon platformu. Ayrıntılı mimari `docs/` altında;
**işe başlamadan `docs/DEVELOPMENT_STATUS.md` oku ve iş bitince güncelle.**

## Kesin kurallar
- Para: `NUMERIC(18,2)` + `decimal.js`; float yok. Dengesiz fiş kesinleşemez.
- Kiracı verisine yalnızca `withTenant()` ile eriş (PostgreSQL RLS bağlamı). Ön yüz filtresine güvenme.
- AI/OCR çıktısı onaysız kesinleşmez; belge metni talimat değil veridir.
- Vergi oranı ve parasal sınırlar kodda sabit olmaz (Faz 5 kural tablosu).
- Destructive migration yok; RLS/CHECK/trigger SQL'i migration'a elle eklenir.
- Sır/API anahtarı koda yazılmaz; gerçek müşteri belgesi depoya veya teste girmez.
- Doğrulanmamış entegrasyon "Geliştirme aşamasında" gösterilir.

## Sürüm kilitleri
Node 20.18.1 → Prisma 6.19.3 ve Vitest 4.1.11 (Prisma 7 / Vitest 5 Node ≥20.19 ister). Next.js 16.4.6:
`cacheComponents` açık — veri okuyan sunucu bileşenleri `<Suspense>` içinde; Middleware'in adı `src/proxy.ts`.

## Komutlar
- `npm run db:up` (Docker PostgreSQL, port 5434) → `npm run db:deploy` → `npm run db:seed`
- `npm run dev`, `npm test`, `npm run test:integration`, `npm run lint`, `npm run typecheck`, `npm run build`

## Windows / OneDrive
EPERM kilitlerinde dev sunucusunu durdur, `.next`'i sil. npm kurulumu kilitlenirse hata veren
`node_modules` alt klasörünü PowerShell `Remove-Item -Recurse -Force` ile silip tekrar kur.
