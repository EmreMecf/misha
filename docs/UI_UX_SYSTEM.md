# UI/UX Sistemi

## İlkeler

- Muhasebe personelinin hızı önce gelir: yoğun tablolar, klavye kısayolları, gereksiz animasyon yok.
- Yalnızca gerçek API verisi; işlevsiz buton veya sahte istatistik yok. Boş durumlar ne yapılacağını söyler.
- Açık ve koyu tema, renkler yalnızca anlamsal token'larla (`globals.css`): `canvas, surface, surface-2,
  line, ink, ink-2, ink-3, brand, brand-soft, good, warning, critical (+soft)`.
- Durum rengi her zaman ikon/etiketle birlikte (renk tek başına anlam taşımaz).
- Erişilebilirlik: görünür odak, etiketli form alanları, klavye ile tam kullanım.

## Yerleşim

Sol kenar çubuğu (masaüstü sabit, mobilde çekmece) + üst bar (aktif ofis, kullanıcı menüsü).
Kenar çubuğu öğeleri fazlarla açılır; henüz yapılmamış modül menüde gösterilmez.

| Faz 1'de | Sonraki fazlarda |
|---|---|
| Genel Bakış, Mükellefler, Personel ve Yetkiler, İşlem Geçmişi | Gelen Evraklar, Belge Arşivi, Fatura İşlemleri, Fiş ve Z Raporları, Muhasebeleştirme, Banka, Cari, Mutabakat, Demirbaş, Amortisman, Vergi Kontrolü, Raporlar, AI Asistanı, Entegrasyonlar, Ayarlar |

## Ekranlar (hedef)

- **Belge inceleme**: 3 panel — liste / önizleme (zoom, döndür, OCR alan vurgulama) / çıkarılan alanlar,
  fiş önerisi, güven skoru, AI gerekçesi, Onayla · Reddet · Aktarıma hazırla.
- **Banka**: hesap, tarih, hareketler, otomatik eşleşmeler ve gerekçeleri, toplu onay.
- **Global**: komut paleti, arama, bildirim merkezi, arka plan işleri, kayıtlı filtreler.
