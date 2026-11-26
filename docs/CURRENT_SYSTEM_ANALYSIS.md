# Mevcut Sistem Analizi (Faz 0)

Tarih: 2026-11-26

## Başlangıç durumu

Önceki MİHSAP klonu deposu (`ÜNAL YAZILIM/mihsap`, git dalı `mihsap-v1`) 2026-11-12 civarında
diskten kayboldu: kaynak kod, `.git`, migration'lar, şartname dosyası ve örnek belgeler yok.
Bilgisayarda (C:, D:, Windows Geri Dönüşüm Kutusu) kopya bulunamadı. Kalan tek iz, eski projenin
derleme çıktısıdır (`ÜNAL YAZILIM/_eski-mihsap-derlemesi-next`, silinmedi, kenara taşındı).

Kullanıcı kararıyla (2026-11-26) proje **sıfırdan** yeniden kuruluyor. Eski kod kopyalanmadı.
Eski çalışmada doğrulanmış **alan bilgisi** (aşağıda) yeni tasarımın girdisi olarak korunur.

> Ders: Proje yalnızca OneDrive klasöründe ve uzak depo olmadan tutuluyordu. Yeni depo için
> GitHub'a (özel) push edilmesi önerilir; bkz. `DEVELOPMENT_STATUS.md` › Açık kararlar.

## Ortam

| Bileşen | Değer | Not |
|---|---|---|
| İşletim sistemi | Windows 10 Pro | Proje OneDrive klasöründe: npm/Next'te EPERM kilitleri görülebilir |
| Node.js | 20.18.1 | Prisma 7 ve Vitest 5 en az 20.19 / 22.12 ister → bilinçli olarak Prisma 6.19.3, Vitest 4.1.11 |
| Docker | 29.8.2 (Docker Desktop, WSL2) | PostgreSQL geliştirme veritabanı için |
| Next.js | 16.4.6 (App Router, Turbopack, `cacheComponents`) | `node_modules/next/dist/docs` güncel kılavuz |

## Mevcut özellik envanteri

Yeni depoda başlangıçta yalnızca `create-next-app` iskeleti vardır. Eski projedeki tüm özellikler
kod olarak **MISSING** durumundadır; aşağıdaki tablo eski projede neyin doğrulandığını ve yeni
projede hangi fazda yeniden ele alınacağını gösterir.

| Özellik (eski proje) | Eski durum | Yeni durum | Hedef faz |
|---|---|---|---|
| Mükellef / ofis yönetimi | COMPLETE (tek ofis, giriş yok) | MISSING | 1 |
| Kullanıcı girişi, RBAC, tenant izolasyonu | yoktu | MISSING | 1 |
| e-Fatura / e-Arşiv UBL-TR XML okuma | COMPLETE (gerçek 10 faturayla test) | MISSING | 2 |
| Fiş / fatura görsel OCR (Claude) | PARTIAL (API anahtarı gerekir) | MISSING | 2, 7 |
| Kural motoru (KDV sağlama, KKEG, tevkifat, tevsik) | COMPLETE | MISSING | 3, 5 |
| VKN hafızası (kategori kapsamlı) | COMPLETE | MISSING | 3 |
| Mükellef hesap planı ve rol eşlemesi | COMPLETE | MISSING | 3 |
| Stok takibi (fatura kalemleri) | COMPLETE | MISSING | 2, 3 |
| Zirve fatura listesi / Luca / Mikro Excel aktarımı | COMPLETE (Zirve listesi gerçek Excel ile eşleşti) | MISSING | 6 |
| Banka, demirbaş, AI asistan, MCP | yoktu | MISSING | 4, 5, 7 |

## Korunan alan bilgisi (yeniden doğrulanacak)

- **UBL-TR 1.2**: ETTN (`cbc:UUID`) mükerrer kontrolünün anahtarı; KDV `TaxTypeCode=0015`;
  tevkifat `WithholdingTaxTotal`; kalemler `InvoiceLine`; satıcı şablonu `AdditionalDocumentReference`
  içinde base64 XSLT olarak gömülü gelebilir.
- **Zirve "Ticari Programlar" Excel aktarımı**: ofisin kullandığı fatura listesi sütunları
  `Fatura Tarihi, Fatura No, Gönderici VKN/TCKN, Gönderici, %0 KDV Matrah, %1 Matrah, KDV %1,
  %10 Matrah, KDV %10, %20 Matrah, KDV %20`, sayfa adı `1`. Zirve tanımı sütun numarasıyla eşler.
- **Muhasebe kuralları**: KDV kuruş toleransı (eski değer 0,05 TL) satırların en büyüğünün
  matrahına yansıtılıyordu; binek oto %70/%30 KKEG; tevsik sınırı. Bu değerler yeni sistemde
  **sürümlü vergi kuralı** olarak, resmî kaynak doğrulamasından sonra aktif edilecek (Faz 5).
- **Pazaryeri giderleri**: aynı satıcı (ör. D-Market) hem komisyon hem reklam faturası keser;
  satıcı-hesap hafızası kategori kapsamlı olmalı.

## Başlangıç testleri

İskelet üzerinde: `npm run lint` ve `npm run build` — sonuçlar `DEVELOPMENT_STATUS.md`'de.
Önceki projenin testleri (144 test) kodla birlikte kayboldu.

## Teknik borç ve riskler

1. OneDrive senkronizasyonu derleme klasörlerini kilitleyebilir (eski projede sık EPERM).
2. Node 20.18 sürüm kilidi (Prisma 7'ye geçiş engeli).
3. Uzak yedek yok (kayıp bu yüzden kalıcı oldu).
