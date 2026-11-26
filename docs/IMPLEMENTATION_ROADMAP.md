# Uygulama Yol Haritası

Her faz `DEVELOPMENT_STATUS.md`'deki tamamlanma kriterleri sağlanmadan tamamlandı sayılmaz:
kod + backend/frontend bağlantısı + migration + unit/integration testleri + güvenlik kontrolü +
hata senaryoları + doküman + bilinen eksikler.

| Faz | Kapsam | Çıkış kriteri |
|---|---|---|
| 0 | Analiz, mimari kararlar, dokümanlar | `docs/` 13 dosya; iskelet lint/build geçer |
| 1 | Kimlik doğrulama, oturum, RBAC, tenant izolasyonu (RLS), ofis/şube/personel, mükellef, mali dönem, denetim kaydı, dosya depolama soyutlaması, iş kuyruğu tablosu | Başka ofisin verisine erişilemediği otomatik testle kanıtlı; giriş → mükellef oluştur → dönem aç akışı çalışır |
| 2 | Belge yükleme (imza/MIME/hash/zip güvenliği), durum makinesi, UBL-TR ayrıştırıcı, PDF metin, Excel, OCR sağlayıcı arayüzü, inceleme ekranı | e-Fatura XML yüklenip alanları doğru çıkar; mükerrer engellenir |
| 3 | Hesap planı (mükellef bazlı), kural önceliği, fiş önerisi + gerekçe, onay, düzeltmeden öğrenme | Yüklenen faturadan dengeli, gerekçeli fiş önerisi; onaysız kesinleşmez |
| 4 | Banka ekstresi (CSV/XLSX/metin PDF), sınıflandırma, mutabakat | Bakiye uyumu kontrolü; eşleşme gerekçesi görünür |
| 5 | Vergi kural motoru (sürümlü, kaynaklı), demirbaş/amortisman | Doğrulanmamış kural aktif olamaz |
| 6 | Integration Hub: Excel, CSV, XML, Zirve fatura listesi | Aktarım önizleme + mükerrer aktarım engeli + geri alma |
| 7 | AI Gateway, asistan, ajanlar, MCP (salt okunur), maliyet ekranı | Belge metni talimat olarak işlenmez; maliyet sınırları uygulanır |
| 8 | Tasarım bütünlüğü, tablolar, erişilebilirlik | |
| 9 | Güvenlik testleri, yedek/geri yükleme, CI/CD, pilot | Production readiness raporu |

## Öncelikli uçtan uca hedef

Personel faturayı yükler → sistem alanları çıkarır → gerekçeli muhasebe fişi önerir → kullanıcı
düzeltir/onaylar → Excel (Zirve listesi) ile aktarır → işlem geçmişinde görünür.
Bu zincir Faz 1 → 2 → 3 → 6'nın en dar kesitiyle önce uçtan uca çalışır hale getirilir; sonra genişletilir.
