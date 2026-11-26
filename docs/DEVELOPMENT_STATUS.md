# Geliştirme Durumu

Bağlam yenilendiğinde buradan devam edin. En son kayıt en üstte.

## Açık kararlar (kullanıcı)

- **Uzak yedek**: Depo yalnızca bu bilgisayarda (OneDrive klasörü). Özel bir GitHub deposuna push önerilir — eski proje bu yüzden geri getirilemedi. CI iş akışı (`.github/workflows/ci.yml`) push sonrası çalışır.
- **Node.js 22 LTS'ye yükseltme**: Prisma 7.10.1+ ve Vitest 5'e geçişi açar; bağımlılık denetimindeki 4 yüksek bulguyu kapatır. Sistem değişikliği olduğu için kullanıcı yapar.
- **Masaüstü kabuğu**: Ofiste çok bilgisayarlı kullanım istendi (2026-11-26). Web uygulaması ileride Electron ile sarılacak; ağ üzerinden kullanımda giriş sistemi artık hazır.
- **Eski veritabanı**: Eski projenin `mihsap-postgres` konteyneri (port 5433) ve verisi duruyor; yeni sisteme taşınmadı, dokunulmadı.

## Faz durumu

| Faz | Durum | Not |
|---|---|---|
| 0 | COMPLETE | 13 doküman; eski depo kaybı kayıtlı |
| 1 | PARTIAL | Kimlik, RBAC, RLS, mükellef, mali dönem, personel, denetim kaydı tamam. Eksik: şube yönetim ekranı, iş kuyruğu ve dosya depolama (Faz 2 ile birlikte), 2FA |
| 2–9 | MISSING | |

## Bilinen eksikler

- `npm audit`: Prisma 6.19 CLI'nin yapılandırma katmanında 4 yüksek bulgu (`deepmerge-ts` <8, `effect` ≤3.22). Çalışma zamanı istek yolunda değil. Çözüm: Node 22 + Prisma 7.10.1+. **CI'daki `npm audit --audit-level=high` adımı bu düzeltilene kadar başarısız olur** (eşik bilinçli olarak düşürülmedi).
- 2FA, CSP nonce, genel hız sınırlayıcı: Faz 9.
- Şubeler veri modelinde var, yönetim ekranı yok.
- Uçtan uca (Playwright) testler yok; arayüz akışı elle tarayıcıda doğrulandı (kayıt → mükellef → dönem → işlem geçmişi).

## Kayıt

### 2026-11-26 — Faz 1 çekirdek
- PostgreSQL 17 (Docker `mihsap-platform-db`, port 5434). Kısıtlı uygulama rolü `mihsap_app` (süper kullanıcı değil, RLS'yi atlayamaz); migration'lar `mihsap_admin` ile.
- RLS: tüm kiracı tablolarında `organization_id = app_current_org()`; denetim kaydına uygulama rolü yalnızca ekleyip okuyabilir.
- Kimlik: argon2id, SHA-256 özetli oturum token'ı, kayan 7 gün / mutlak 30 gün, giriş hız sınırı, geçici parola + zorunlu değişim, Origin tabanlı CSRF kontrolü.
- API: `/api/v1` (auth, me, taxpayers, fiscal-periods, assignments, members, audit-logs, health).
- Arayüz: giriş, ofis kaydı, Genel Bakış, Mükellefler (liste/ekle/detay/dönem/atama), Personel ve Yetkiler, İşlem Geçmişi, Hesabım.
- Testler: 9 birim + 14 entegrasyon (kiracı izolasyonu RLS dahil). Lint, tip kontrolü, build temiz. CI iş akışı eklendi (henüz GitHub'da çalıştırılmadı).

### 2026-11-26 — Sıfırdan başlangıç (Faz 0)
- Eski depo kayıp (bkz. CURRENT_SYSTEM_ANALYSIS.md). Kullanıcı sıfırdan başlamayı seçti.
- `create-next-app@16.4.6` iskeleti, git deposu (`main`), sabit sürümlü bağımlılıklar. Faz 0 dokümanları.
