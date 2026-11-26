# Muhasebe Motoru (Faz 3, tasarım)

## Hesap planı

TDHP ana hesapları başlangıç şablonudur, sabit eşleme değildir. Her mükellefin kendi hesap planı
(alt hesaplar, kendi kod biçimi ör. `770 01 001`) vardır. Kural motoru "rol → hesap" eşlemesi kullanır
(gider kategorisi, KDV oranı, satıcılar, kasa, banka, KKEG …); rol mükellefe göre çözümlenir.

## Karar önceliği

1. Mükellefe özel kesin kurallar
2. Kullanıcının onayladığı şablonlar
3. Satıcı VKN eşleşmesi (kategori kapsamlı: aynı satıcı farklı türde fatura kesebilir)
4. Geçmiş onaylı kayıtlar
5. Ürün/hizmet sınıflandırması
6. Benzer belge araması
7. Deterministik kurallar
8. AI önerisi
9. Matematiksel ve mevzuat doğrulaması
10. İnsan onayı

Her öneri kaynağını ve gerekçesini taşır (ör. "Aynı satıcının daha önce onaylanan 4 faturası 760.02'ye işlendi").

## Fiş

- `journal_entries` + `journal_entry_lines`: çok satır, borç/alacak, cari, KDV, stopaj, tevkifat, iskonto,
  döviz, masraf merkezi, proje, şube, belge bağlantısı, onay geçmişi.
- Dengesiz fiş kesinleşemez: veritabanı trigger'ı (borç = alacak) + uygulama kontrolü.
- Kesinleşmiş fiş değiştirilmez; düzeltme ters kayıtla.
- Tüm hesaplamalar `decimal.js`; yuvarlama kuralı vergi motorundan gelir.

## Öğrenme

Kullanıcı hesabı değiştirdiğinde ilk öneri, seçilen hesap, neden, satıcı ve belge türü saklanır; mükellefe
özel kural oluşturulması önerilir. Öğrenilen kural başka mükellefe izinsiz uygulanmaz.

## Eski projeden korunan, yeniden doğrulanacak kurallar

KDV satır sağlaması (matrah × oran ≈ KDV, kuruş toleransı), kuruş farkının en büyük satırın matrahına
yansıtılması, binek oto %70/%30 KKEG, tevsik sınırı, perakende fişlerin 10 günlük toplu fişte birleştirilmesi.
Oranlar ve sınırlar kodda sabit değil, vergi kural tablosundan okunacak (Faz 5).
