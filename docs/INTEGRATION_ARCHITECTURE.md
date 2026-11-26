# Entegrasyon Mimarisi (Faz 6, tasarım)

## Ortak arayüz

```ts
interface AccountingIntegration {
  connect(); authenticate(); validate();
  fetchAccounts(); fetchTaxpayers();
  prepareExport(); previewExport(); exportEntries(); verifyExport(); getExportStatus();
  disconnect();
}
```

Dosya tabanlı hedefler (Excel/CSV/XML) için connect/authenticate işlemsizdir; `exportEntries` dosya üretir.

## Öncelik ve durum

| Hedef | Yöntem | Durum |
|---|---|---|
| Excel / CSV | dosya | Faz 6'da ilk tamamlanacak |
| Zirve (Ticari Programlar fatura listesi) | Excel | Biçim kullanıcının gerçek Excel'iyle biliniyor; yeniden uygulanacak |
| Zirve / Luca / Mikro mahsup fişi | Excel | Resmî şablon kamuya açık değil → "Geliştirme aşamasında", sütun düzeni ofisçe düzenlenebilir |
| Logo, ETA, Altos | — | Belgelenmiş format bulunana kadar "Geliştirme aşamasında" |
| e-Fatura entegratörleri, GİB | resmî API | Kimlik bilgisi düz metin saklanmaz; yetkisiz otomasyon yok |

## Kurallar

- Aktarılan kayıt işaretlenir; aynı kayıt ikinci kez aktarılamaz (mükerrer engeli), aktarım geri alınabilir.
- Doğrulanmamış entegrasyon arayüzde "Geliştirme aşamasında" görünür.
- Masaüstü ajanı (gerekirse): cihaz eşleştirme, şifreli bağlantı, aktarım kuyruğu, önizleme, imzalı güncellemeler.
