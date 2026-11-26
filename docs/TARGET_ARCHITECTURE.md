# Hedef Mimari

## İlke: modüler monolit

Tek Next.js uygulaması (App Router) hem arayüzü hem API'yi sunar. İş mantığı `src/server/<modül>`
altında, HTTP'den bağımsız servislerdedir; route handler'lar yalnızca doğrulama + yetki + çağrı yapar.
Ağır işler (OCR, AI, toplu aktarım) önce aynı kod tabanında **PostgreSQL tabanlı iş kuyruğu** ile
arka plan worker'ına taşınır; ölçek gerektiğinde ayrı servise ayrılır.

```
Tarayıcı / Masaüstü kabuğu
        │  HTTPS, oturum çerezi
Next.js 16 (App Router)
  ├─ src/app            ekranlar (Server Components + Suspense)
  ├─ src/app/api/v1     route handler'lar (JSON API)
  ├─ src/proxy.ts       iyimser oturum kontrolü, güvenlik başlıkları
  └─ src/server/*       modüller: auth, tenancy, taxpayers, documents, accounting, tax, bank, assets, ai, integrations, audit
        │  Prisma 6 (tenant bağlamı = transaction içinde set_config)
PostgreSQL 17  ── Row Level Security (organization_id)
        │
Worker (Faz 2+) ── jobs tablosu, FOR UPDATE SKIP LOCKED, retry + dead letter
Belge/OCR servisi (Faz 2+, gerekirse Python/FastAPI)
```

## Teknoloji kararları

| Karar | Seçim | Gerekçe |
|---|---|---|
| Web çatısı | Next.js 16.4.6 | Kullanıcının mevcut yığını; tek dağıtım birimi |
| Veritabanı | PostgreSQL 17 | İlişkisel bütünlük, RLS, `NUMERIC` para, JSONB |
| ORM | Prisma 6.19.3 | Node 20.18 ile uyumlu son kararlı sürüm (Prisma 7: Node ≥20.19) |
| Kimlik doğrulama | Kendi oturum katmanı: argon2id + veritabanı oturumları | Harici servis bağımlılığı yok; oturum iptali ve denetim tam kontrolde |
| Kiracı izolasyonu | Uygulama katmanı + PostgreSQL RLS | Ön yüz filtresine güvenilmez; sorgu hatası bile başka ofisin verisini döndüremez |
| Kuyruk | Başlangıçta PostgreSQL `jobs` tablosu | Redis'i zorunlu bağımlılık yapmamak; yük artınca BullMQ'ya geçiş arayüz arkasında |
| Para | `NUMERIC(18,2)` + `decimal.js` | Float yasak |
| Doğrulama | Zod 4 | Tüm API girdileri şemayla |
| AI | Sağlayıcı bağımsız gateway (Faz 7) | Anthropic / OpenAI / Gemini / Ollama aynı arayüz; deterministik ayrıştırıcı önce |
| Masaüstü | Electron kabuğu (sonraki faz) | Kullanıcı ofiste ağ üzerinden çok bilgisayarlı kullanım istedi; web uygulaması aynen sarılır |

## Modüller ve sınırlar

| Modül | Sorumluluk | Faz |
|---|---|---|
| `auth` | parola, oturum, giriş denemesi sınırı | 1 |
| `tenancy` | ofis, şube, üyelik, rol/izin, tenant bağlamı | 1 |
| `taxpayers` | mükellef, mali dönem, personel ataması | 1 |
| `audit` | değiştirilemez işlem kaydı | 1 |
| `documents` | yükleme, güvenlik, hash, durum makinesi, ayrıştırıcı yönlendirme | 2 |
| `accounting` | hesap planı, kurallar, fiş önerisi, öğrenme | 3 |
| `bank` | ekstre adaptörleri, sınıflandırma, mutabakat | 4 |
| `tax`, `assets` | sürümlü vergi kuralları, demirbaş/amortisman | 5 |
| `integrations` | ortak arayüzlü aktarım (Excel, CSV, Zirve, Luca …) | 6 |
| `ai` | gateway, asistan, ajanlar, maliyet, MCP | 7 |

Modüller birbirinin tablolarına doğrudan yazmaz; servis fonksiyonları üzerinden konuşur.
