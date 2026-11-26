# Özellik Boşluk Analizi

Durum kodları: COMPLETE · PARTIAL · BROKEN · MISSING · DEPRECATED · NEEDS_REFACTOR · NEEDS_VERIFICATION.
Başlangıçta (2026-11-26) yeni depoda tüm modüller MISSING. Güncel durum için `DEVELOPMENT_STATUS.md`.

| # | Modül | Durum | Faz | Not |
|---|---|---|---|---|
| 1 | Dashboard | MISSING | 1 (temel), 8 | Yalnızca gerçek API verisi |
| 2 | Mükellef yönetimi | MISSING | 1 | NACE, faaliyet alanı, mali dönemler, personel ataması |
| 3 | Evrak yönetimi | MISSING | 2 | Hash, mükerrer, durum makinesi |
| 4 | Akıllı belge okuma | MISSING | 2 | Önce deterministik ayrıştırıcılar |
| 5 | e-Fatura / e-Arşiv | MISSING | 2 | UBL-TR bilgisi korunuyor (bkz. CURRENT_SYSTEM_ANALYSIS) |
| 6 | Fiş ve Z raporu | MISSING | 2 | OCR + AI, insan onayı zorunlu |
| 7 | Otomatik muhasebeleştirme | MISSING | 3 | Dengeli fiş DB kısıtı |
| 8 | Banka ekstresi | MISSING | 4 | Örnek ekstre olmayan banka "destekleniyor" gösterilmez |
| 9 | Cari hesap | MISSING | 3, 4 | |
| 10 | Demirbaş / amortisman | MISSING | 5 | Resmî faydalı ömür listesi doğrulanmadan aktif kural yok |
| 11 | Vergi ve mevzuat | MISSING | 5 | Sürümlü, kaynaklı kurallar |
| 12 | AI asistanı | MISSING | 7 | Yalnızca onaylı araç çağrıları |
| 13 | AI ajanları | MISSING | 7 | Kullanıcı onayı olmadan kesin kayıt yok |
| 14 | Muhasebe programı entegrasyonları | MISSING | 6 | Önce Excel/CSV; Zirve fatura listesi formatı biliniyor |
| 15 | Finansal raporlama | MISSING | 7, 8 | |
| 16 | Ofis ve personel yönetimi | MISSING | 1 | RBAC 7 rol |
| 17 | Bildirimler | MISSING | 8 | |
| 18 | Dijital arşiv | MISSING | 2 | |
| 19 | Güvenlik ve denetim | MISSING | 1 (çekirdek), 9 | Audit log Faz 1'de |
| 20 | Kullanım ve maliyet | MISSING | 7 | |

## Bilinçli olarak sonraya bırakılanlar

- Redis/BullMQ, S3, OpenTelemetry: ihtiyaç doğunca; arayüzler buna göre soyut tutulur.
- Python belge servisi: Node tarafındaki deterministik ayrıştırıcılar yetmediğinde (taranmış belge OCR).
- 2FA: Faz 1'de veri modeli hazırlanır, TOTP akışı Faz 9 güvenlik sertleştirmesinde.
