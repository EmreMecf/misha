# Veritabanı Mimarisi

PostgreSQL 17 · Prisma 6.19.3 · şema dosyası `prisma/schema.prisma` · migration'lar `prisma/migrations`.

## Kurallar

- Tablo/kolon adları `snake_case` (Prisma'da `@@map`/`@map`), birincil anahtar `uuid` (`gen_random_uuid()`).
- Para: `NUMERIC(18,2)`; oran: `NUMERIC(5,2)`; miktar: `NUMERIC(18,4)`. Uygulamada `decimal.js`.
- Her tabloda `created_at`, değişebilenlerde `updated_at`; kiracı verisinde `organization_id`.
- Kesinleşmiş finansal kayıt silinmez/değiştirilmez: düzeltme = ters kayıt (Faz 3).
- Destructive migration yasak: kolon kaldırma/yeniden adlandırma iki aşamalı yapılır.
- Prisma'nın ifade edemediği CHECK, trigger ve RLS politikaları migration SQL'ine elle eklenir.

## Kiracı izolasyonu (RLS)

- Kiracı tablolarında `ENABLE` + `FORCE ROW LEVEL SECURITY`.
- Politika: `organization_id = current_setting('app.organization_id', true)::uuid`.
- Uygulama her kiracı işlemini transaction içinde açar ve `set_config('app.organization_id', $1, true)` çalıştırır
  (`src/server/tenancy/tenantDb.ts`). Bağlam yoksa ayar boştur → hiçbir satır görünmez/yazılamaz.
- Kiracı dışı tablolar (kullanıcılar, oturumlar, giriş denemeleri) RLS'siz; erişim yalnızca auth modülünden.
- Ofis oluşturma ve üyelik doğrulaması gibi sistem işlemleri `app.organization_id`'yi yeni ofisin id'si ile ayarlar.

## Faz 1 tabloları

| Tablo | Açıklama | RLS |
|---|---|---|
| `users` | e-posta (benzersiz, küçük harf), argon2id parola özeti, durum | hayır |
| `sessions` | token'ın SHA-256 özeti, kullanıcı, aktif ofis, son kullanım, bitiş | hayır |
| `login_attempts` | e-posta + IP bazlı deneme kaydı (hız sınırı) | hayır |
| `organizations` | muhasebe ofisi (unvan, VKN) | kendi satırı |
| `branches` | şube | evet |
| `memberships` | kullanıcı × ofis × rol (+ şube) | evet |
| `taxpayers` | mükellef: unvan, VKN/TCKN, vergi dairesi, NACE, faaliyet, defter türü | evet |
| `taxpayer_assignments` | personel × mükellef yetkisi | evet |
| `fiscal_periods` | mükellef mali dönemi (başlangıç/bitiş, açık/kapalı) | evet |
| `audit_logs` | kim, ne, hangi kaynak, önce/sonra özeti, IP | evet (yalnızca ekleme) |
| `jobs` | arka plan işi (tür, yük, durum, deneme, kilit) | evet |

İstenen diğer tablolar (documents, invoices, journal_entries, bank_*, fixed_assets, ai_* …) ilgili fazda
bu kurallarla eklenir; `docs/FEATURE_GAP_ANALYSIS.md` faz eşlemesini içerir.

## Roller

`SUPER_ADMIN` (platform), `OFFICE_OWNER`, `ACCOUNTANT` (mali müşavir), `STAFF` (muhasebe personeli),
`AUDITOR`, `TAXPAYER_USER` (mükellef), `READ_ONLY`. İzin matrisi kodda (`src/server/tenancy/permissions.ts`)
tek kaynaktır; veritabanında üyeliğin rolü tutulur.
