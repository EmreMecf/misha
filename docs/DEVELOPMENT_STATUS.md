# Geliştirme Durumu

Bağlam yenilendiğinde buradan devam edin. En son kayıt en üstte.

## Açık kararlar (kullanıcı)

- **Uzak yedek**: TAMAM — https://github.com/EmreMecf/misha (kullanıcı onayıyla herkese açık). Push için `env -u GH_TOKEN -u GITHUB_TOKEN git push` (ortamdaki GH_TOKEN geçersiz).
- **Fiş şablonlarının muhasebeci onayı**: Alış/satış/tevkifat/iade kayıt şablonları (bkz. ACCOUNTING_ENGINE.md) yaygın uygulamaya göre yazıldı; hiçbir fiş onaysız kesinleşmez ama şablonların bir mali müşavirce gözden geçirilmesi gerekir (özellikle iade ve ÖTV gibi KDV dışı vergiler).
- **OCR / yapay zekâ sağlayıcısı (Faz 2 devamı / Faz 3)**: PDF ve görsel belgelerin okunması için ücretli bir servis (ör. Claude API) gerekir; belge içeriği dış servise gider. Kullanıcı onayı ve API anahtarı gerektirir.
- **Node.js 22 LTS'ye yükseltme**: Prisma 7.10.1+ ve Vitest 5'e geçişi açar; bağımlılık denetimindeki 4 yüksek bulguyu kapatır. Sistem değişikliği olduğu için kullanıcı yapar.
- **Masaüstü kabuğu**: Ofiste çok bilgisayarlı kullanım istendi (2026-11-26). Web uygulaması ileride Electron ile sarılacak; ağ üzerinden kullanımda giriş sistemi artık hazır.
- **Eski veritabanı**: Eski projenin `mihsap-postgres` konteyneri (port 5433) ve verisi duruyor; yeni sisteme taşınmadı, dokunulmadı.

## Faz durumu

| Faz | Durum | Not |
|---|---|---|
| 0 | COMPLETE | 13 doküman; eski depo kaybı kayıtlı |
| 1 | PARTIAL | Kimlik, RBAC, RLS, mükellef, mali dönem, personel, denetim kaydı, iş kuyruğu, dosya depolama tamam. Eksik: şube yönetim ekranı, 2FA |
| 2 | PARTIAL | Yükleme (çoklu/ZIP), güvenlik kontrolleri, mükerrer tespiti, durum makinesi, iş kuyruğu, UBL-TR e-Fatura/e-Arşiv XML okuma + doğrulama, kontrol ekranı tamam. Eksik: PDF metin çıkarma, OCR, AI sınıflandırma, Excel/CSV banka ekstresi okuma, elle alan düzeltme |
| 3 | PARTIAL | Mükellef hesap planı (TDHP şablonu + alt hesap), hesap rolleri, kural önceliği (kesin kural → geçmiş onay → rol), gerekçeli fiş önerisi, onay/kesinleştirme, ters kayıt, düzeltmeden öğrenme, yevmiye listesi tamam. Eksik: elle fiş / satır tutarı düzenleme, ürün sınıflandırma ve benzer belge katmanları, AI önerisi (Faz 7), muavin/mizan raporları |
| 4 | PARTIAL | Banka hesabı (IBAN doğrulama, defter hesabı), CSV/XLSX ekstre aktarımı (bankadan bağımsız sütun eşleme + önizleme), satır satır bakiye kontrolü ve süreklilik uyarısı, mükerrer aktarım engeli, gerekçeli eşleştirme önerisi (fatura / anahtar kelime kuralı), onayla fiş kesme, ters kayıtla geri alma, kural öğrenme tamam. Eksik: PDF ekstre, kısmi/toplu ödeme eşleştirme, döviz hesap, toplu onay, AI sınıflandırma |
| 5–9 | MISSING | |

## Bilinen eksikler

- `npm audit`: Prisma 6.19 CLI'nin yapılandırma katmanında 4 yüksek bulgu (`deepmerge-ts` <8, `effect` ≤3.22). Çalışma zamanı istek yolunda değil. Çözüm: Node 22 + Prisma 7.10.1+. **CI'daki `npm audit --audit-level=high` adımı bu düzeltilene kadar başarısız olur** (eşik bilinçli olarak düşürülmedi).
- 2FA, CSP nonce, genel hız sınırlayıcı: Faz 9.
- Şubeler veri modelinde var, yönetim ekranı yok.
- Uçtan uca (Playwright) testler yok; arayüz akışı elle tarayıcıda doğrulandı (kayıt → mükellef → dönem → işlem geçmişi; belge yükleme → kontrol → onay; PDF önizleme).
- PDF / görsel / Excel belgeler saklanır ama okunmaz: "Düzeltme gerekli" durumuna düşer ve nedeni açıkça yazılır. Okunan alanlar henüz elle düzeltilemez (yalnızca kontrol edildi / reddet / yeniden işle).
- Dosyalar yerel diskte (`STORAGE_DIR`, varsayılan `./storage`, git dışında). Çok bilgisayarlı kurulumda paylaşılan bir konum veya nesne deposu gerekecek.
- Varsayılan olarak işler istek sonrasında (`after()`) aynı süreçte çalışır; yük artınca `INLINE_JOBS=false` + `npm run worker`.
- Fiş satır tutarları düzenlenemez (faturadan gelir). Toplamları tutarsız fatura dengesiz öneri üretir ve kesinleşemez; çözüm belgeyi reddetmek. Elle fiş girişi sonraki adım.
- Döviz faturasında satır bazlı TL yuvarlaması kuruş farkı doğurursa fiş dengesiz işaretlenir; kuruş farkının otomatik dağıtımı Faz 5 vergi/yuvarlama kurallarıyla gelecek.
- Banka eşleştirmesi yalnızca tutarı faturanın ödenecek tutarına birebir eşit hareketlerde fatura önerir (kısmi, toplu ve taksitli ödemeler sonraki adım). Döviz banka hesapları "geliştirme aşamasında" (yalnız TL).
- Banka ekstresinde "Borç" çıkış, "Alacak" giriş kabul edilir (Türk bankalarının yaygın kullanımı); farklıysa önizlemede "işareti ters çevir" seçilir. Hiçbir banka biçimi gerçek ekstreyle doğrulanmadı; sentetik örneklerle test edildi.
- `jobs` tablosunda uygulama rolünün silme izni yok (kuyruk geçmişi korunur); eski işlerin temizliği için ileride yönetici görevi gerekir.

## Kayıt

### 2026-11-27 — Faz 4 banka ekstresi ve mutabakat (çekirdek)
- Veri modeli: `bank_accounts`, `bank_statements` (dosya SHA-256 tekil), `bank_transactions` (parmak izi tekil, işaretli tutar), `bank_rules`. RLS; ekstre/hareket satırları silinemez, hareketin ekstre verisi tetikleyiciyle değiştirilemez; bir fatura tek harekete bağlanabilir (kısmi tekil indeks). Fiş kaynağına `BANK`, satır türüne `BANK` eklendi (kısıt yeniden tanımlandı, veri korunarak).
- Ayrıştırıcı (`statementParser.ts`, saf): CSV (ayraç tespiti, tırnak, UTF-8/Windows-1254), XLSX (fflate + fast-xml-parser; yeni bağımlılık yok, DTD reddi, boyut sınırı), başlık satırı ve sütun tahmini, Türkçe/İngilizce sayı biçimleri, Excel tarih seri numarası, ara toplam satırlarını atlama. Bakiye kontrolü sırayı (eski→yeni / yeni→eski) bakiyeden anlar.
- Mükerrer: dosya içi sıra numaralı parmak izi — aynı dosya ikinci kez reddedilir, çakışan ekstrelerde aynı hareketler atlanır, aynı gün aynı tutarlı gerçek hareketler ayrışır.
- Eşleştirme (`matchEngine.ts`, saf): tutar eşitliği zorunlu; fatura no, VKN, karşı taraf adı, tarih yakınlığı puanlanır ve gerekçe olarak yazılır; belirsizlikte öneri yapılmaz. Fatura yoksa en uzun anahtar kelime kuralı.
- Mutabakat: fatura eşleşmesi faturanın fişindeki cari hesabı kullanır (ödeme 320 B / 102 A, tahsilat 102 B / 120 A); hesaba işleme istenirse kural öğrenir. Fiş iptal edilirse hareket yeniden bekler. Kesinleştirme `journal:post`; personel ekstre aktarıp yok sayabilir.
- Arayüz: mükellef → Banka (hesaplar), hesap sayfası (ekstre aktar + eşleme önizleme, hareketler + öneriler, ekstreler, kurallar).
- Düzeltme migration'ı `20261127091000_bank_trigger_fix`: tetikleyici fonksiyonu tabloda olmayan alana eriştiği için jsonb ile yeniden yazıldı (önceki migration değiştirilmedi).
- Testler: 18 birim (ayrıştırıcı 10, eşleştirme 8) + 10 entegrasyon. Tarayıcıda sentetik ekstreyle uçtan uca doğrulandı.

### 2026-11-26 — Faz 3 muhasebe motoru (çekirdek)
- Veri modeli: `ledger_accounts` (mükellefe özel, kod biçimi CHECK), `account_role_mappings`, `posting_rules` (karşı taraf + yön → hesap), `journal_entries`, `journal_entry_lines`, `account_corrections` (değiştirilemez öğrenme kaydı). Hepsi RLS altında.
- Veritabanı kuralları (tetikleyici): kesinleşmede en az 2 satır, boş hesap yok, borç = alacak > 0, mali dönem açık, toplamlar tetikleyicide yazılır; kesin fiş ve satırları değiştirilemez/silinemez (yalnız POSTED → REVERSED); satır hesabı aynı mükellefin aktif, kayıt yapılabilir hesabı olmalı; belge başına tek geçerli fiş (kısmi tekil indeks).
- Kural motoru (`proposalEngine.ts`, saf fonksiyon): kesin kural → aynı karşı tarafın geçmiş kesin fişleri → rol eşlemesi; her satır kaynak + gerekçe taşır. Alış, satış, alış/satış tevkifatı, KDV dışı vergi, iki yönlü iade, döviz (faturadaki kur). Tutarsız toplamlar otomatik kapatılmaz, hata olarak işaretlenir.
- Akış: belge "Kontrol edildi" → öneri (hesap planı varsa) → hesap düzeltme → kesinleştir (yevmiye no dönem içinde sıralı, dönem satırı kilitlenir) → belge "Onaylandı". Ters kayıt aynı dönemde kesinleşir, belge yeniden öneri bekler. Ana satır değiştirilirse istenirse kesin kural oluşur (yalnız o mükellef).
- Yetki: `ledger:read`, `ledger:manage` (hesap planı), `journal:edit` (taslak; personel dahil), `journal:post` (kesinleştir/iptal; ofis sahibi ve mali müşavir).
- Arayüz: belge sayfasında fiş paneli, mükellef → Hesap planı (hesaplar, alt hesap, roller, öğrenilen kurallar), mükellef → Yevmiye.
- Testler: 11 birim (kural motoru) + 10 entegrasyon (öğrenme döngüsü, tetikleyiciler, ters kayıt, kapalı dönem, izolasyon, personel yetkisi). Toplam 33 birim + 34 entegrasyon.

### 2026-11-26 — Faz 2 belge zekâsı (XML kısmı)
- Veri modeli: `documents`, `document_status_events` (değiştirilemez), `document_extractions` (alan başına kaynak/yöntem/güven), `invoices`, `invoice_lines`, `invoice_taxes`, `jobs`. Hepsi RLS altında (jobs hariç: kiracıdan bağımsız kuyruk). Mükerrer için kısmi tekil indeksler (SHA-256 ve ETTN).
- Güvenlik: içerik imzasıyla biçim tespiti (uzantı uyuşmazlığı ret), HTML ret, ZIP yol geçişi / iç içe ZIP / zip bombası koruması, DTD/ENTITY içeren XML ret, gömülü XSLT çalıştırılmaz. Dosya yanıtı: PDF için `object-src 'self'`, diğerleri `sandbox` CSP, yalnız aynı kökenden çerçeve.
- Durum makinesi: 18 durum, iyimser sürüm kontrolü, her geçiş olay kaydı. İş kuyruğu: `FOR UPDATE SKIP LOCKED`, idempotency anahtarı, üstel bekleme, DEAD, takılı kilit geri alma.
- UBL-TR ayrıştırıcı + doğrulama (kalem toplamı, KDV hesabı, ödenecek tutar, tevkifat, döviz kuru, VKN/TCKN kontrol basamağı), yön tespiti (alış/satış/başkasına ait → ret), açık mali dönem eşleştirme.
- Arayüz: mükellef → Belgeler (sürükle-bırak yükleme, durum süzgeçleri, otomatik yenileme), belge kontrol ekranı (önizleme, okunan alanlar, doğrulama, kalemler, vergiler, durum geçmişi, onay/ret/yeniden işle).
- Testler: 22 birim + 24 entegrasyon (yükleme hattı, mükerrer, ZIP, dönem yokken düzeltme ve yeniden işleme, idempotency, retry → DEAD, belge izolasyonu, değiştirilemez durum geçmişi).

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
