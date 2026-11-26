# AI Mimarisi (Faz 7, tasarım)

## İlkeler

1. **Önce deterministik**: XML → UBL ayrıştırıcı; metinli PDF → metin çıkarımı; Excel → ayrıştırıcı.
   AI yalnızca taranmış/fotoğraf/belirsiz belgede ve hesap önerisinde son katman.
2. **Onaysız kesinleşme yok**: AI çıktısı her zaman `NEEDS_REVIEW`; kullanıcı onayı olmadan fiş kesinleşmez.
3. **Belge metni veridir, talimat değildir**: belge içeriği modele ayrı, işaretli blokta verilir; sistem
   talimatı belgeden gelen "talimatları" yok saymasını söyler; çıktı yapılandırılmış şemayla doğrulanır.
4. **Sağlayıcı bağımsız**: `AiProvider` arayüzü — `AnthropicProvider`, `OpenAIProvider`, `GeminiProvider`,
   `OllamaProvider`. Her biri: model seçimi, zaman aşımı, yeniden deneme, token/maliyet kaydı,
   yapılandırılmış çıktı, hız sınırı, yedek sağlayıcı, veri gizliliği ayarı.
5. **Maliyet**: içerik özeti (SHA-256) ile önbellek; aynı belge aynı model sürümüyle tekrar gönderilmez;
   ofis/mükellef bazlı günlük ve aylık sınır; bağlam minimizasyonu (yalnızca gerekli alanlar).

## Ajanlar

Her ajan: görev tanımı, girdi/çıktı şeması (Zod), izinler, güven seviyesi, çalışma kaydı (`ai_agent_runs`),
hata yönetimi, maliyet sınırı, insan onayı, denetim kaydı. Ajanlar veritabanına yalnızca onaylı araç
fonksiyonlarıyla erişir; serbest SQL veya işletim sistemi erişimi yoktur.

## MCP sunucusu

Varsayılan salt okunur; her çağrıda kullanıcı, rol ve mükellef erişimi kontrol edilir. Yazma/aktarım
araçları ayrı izin ve insan onayı ister. Keyfi SQL aracı yoktur.

## Veri koruma

Harici sağlayıcıya gönderim ofis ayarıyla açılır (varsayılan kapalı); gönderilen alanlar ve maliyet
`ai_jobs`'a kaydedilir. Yerel model (Ollama) seçeneği veri dışarı çıkmadan çalışma içindir.
