# E-posta Faz 6 — Son 15 günün en düşük fiyatı bildirimi

**Tarih:** 24 Eylül 2026
**Kapsam:** favorilenen ürünün fiyatı son 15 günün en düşük fiyatına indiğinde müşteriye tek bir
bildirim (in-app + e-posta). Bu fazla birlikte ürün ve varyant bazında güvenilirliği kanıtlanabilen bir
etkin fiyat geçmişi, sepet ve fiyat e-postaları için ortak gönderim sınırları ve ürün sayfasındaki
varyant fiyatı düzeltmesi geldi. Faz 1'in outbox/gönderim altyapısı ve Faz 5'in kapasite sınırlı toplu
hat kalıbı kullanılır.

---

## 1. Kullanıcı kararları (2026-09-24)

- **Kitle yalnız favorileyenler.** Mağaza takibi tek başına hiçbir indirim veya fiyat bildiriminin
  nedeni değildir. Eski "indirim başladı" bildirimleri kapandı: `product_discount_favorited` (favori)
  ve `store_discount_followed_seller` (mağaza takibi), hem in-app hem e-posta. Bir ürünü hem favorileyen
  hem mağazasını takip eden kullanıcı, favorisi nedeniyle tek bildirim alır.
- **Sepet e-postası (`product_discount_in_cart`) içerik ve tetik olarak aynen devam eder.** Ürünün yalnız
  sepette olması yeni fiyat bildirimine hak kazandırmaz.
- **Ortak sınırlar** — sepet ve fiyat e-postaları birlikte sayılır, işlemsel e-postalar sayılmaz:
  - aynı kullanıcı ve ürün için 7 günde en fazla 1 e-posta,
  - kullanıcı başına kayan 24 saatte en fazla 3 e-posta.
- **Öncelik:** ikisi aynı anda uygunsa 15 gün kontrollü fiyat e-postası gönderilir. Bu karar işlerin
  hangi sırayla çalıştığına bırakılmaz (§7).
- **İlk 15 gün beklenir.** Güvenilir geçmiş 15 güne ulaşmadan favori fiyat bildirimi gönderilmez. Eski
  bildirimler bu beklemeyi aşmak için kullanılmaz. Bir kullanıcı ürünü hem favorilemiş hem sepetine
  eklemişse ve o ürün için uygun bir fiyat olayı yoksa (örneğin ilk 15 gün içinde), sepet e-postasını
  almaya devam eder; sepet ayrı bir nedendir.
- **E-postada yalnız yeni fiyat gösterilir:** "son 15 günün en düşük fiyatında: X TL". Üstü çizili fiyat,
  indirim oranı, "indirim" kelimesi ve diğer varyantlar e-postada yer almaz.
- **Varyant sayfası bu fazda düzeltildi.** Ürün sayfası sepetle aynı etkin fiyat hesabını kullanır.
  E-postadaki bağlantı ilgili varyant seçili olarak açılır.
- **Dağıtımı ve canlı doğrulamayı ajan yapar.** Tek istisna: 15 günlük geçmiş dolmadan gerçek fiyat
  e-postası gönderilemez; bu doğrulama "beklenen bekleme" olarak kalır.

## 2. Etkin fiyat ve fiyat anahtarları

Tek hesap `api/domain/effective-price.ts` dosyasındadır. Sepet, checkout, ürün sayfası ve fiyat geçmişi
aynı `applyEffectivePricing` fonksiyonunu kullanır. Bu fonksiyon daha önce sepet ve checkout içinde
birebir kopya olarak duruyordu; davranışı değişmedi.

- Fiyat KDV dahildir (saklanan fiyatlar zaten brüttür). Kupon, kargo ve EFT indirimi hesaba girmez.
- Kural önceliği değişmedi: ürün > kategori > tüm ürünler. Aynı kapsamdaki kurallardan, ürün fiyatına
  uygulandığında en düşük sonucu veren seçilir; seçilen kural varyantın kendi taban fiyatına uygulanır.
- **Fiyat anahtarı** sepette satın alınabilen fiyat noktasıdır:
  - varyantlı üründe her varyant bir anahtardır: `variant:{id}`, taban fiyat `variant.price ?? product.price`,
  - varyantsız üründe tek anahtar vardır: `product:{id}`.

## 3. Veri modeli — migration `20260925090000_price_history_lowest_price` (yalnız ekleme)

| Değişiklik | Açıklama |
|---|---|
| `product_price_history` | Silinmeyen fiyat noktaları: `seq` (ekleme sırası), `priceKey`, `price`, `basePrice`, `discountRuleId`, `source`, `recordedAt`, `predicted`, `materializedAt`, `cancelledAt`/`cancelReason`, `txId`. |
| `price_key_tracking` | Anahtar başına güvenilirlik: `trackedSince`, `lastResetAt`, `lastResetReason`. |
| `price_change_markers` | Tetikleyicilerin yazdığı değişiklik izi. |
| `price_change_explanations` | Uygulama kaydedicisinin "bu işlemde bunu kaydettim" beyanı: `(txId, entityType, entityId)`. |
| `price_drop_events` | Her düşüşün değerlendirmesi: `candidate` → `ineligible` / `grouped` / `pending` → `dispatching` → `dispatched`, ya da `cancelled`. |
| `price_drop_recipients` | Olay başına dondurulmuş alıcılar: `awaiting_capacity` / `reserved` / `skipped` ve gerekçe. |
| `campaign_email_dispatches` | Rezervasyon yaşam döngüsü eklendi: `status` (`reserved` / `sending` / `sent` / `uncertain` / `released`), `releaseReason`, `sendingAt`, `sentAt`, `eventKey`. Eski satırlar `sent` olarak işaretlendi (`sentAt = emailSentAt ?? createdAt`), böylece limitlerde sayılmaya devam ederler. |
| Tetikleyiciler | `products`, `product_variants`, `discount_rules`, `discount_rule_products` (§4). |
| SQL fonksiyonu | `hanuja_discount_rule_live_status()` — `deriveRuleStatus` ile aynı mantık. |
| Enum değerleri | `NotificationType.product_price_drop`, `CampaignDispatchSource.price_drop`; yeni enum'lar `CampaignDispatchStatus`, `PriceHistorySource`, `PriceDropEventStatus`, `PriceDropRecipientStatus`. |

Yeni ortam değişkeni yok.

## 4. Geçmişin güvenilirliği

Geçmişin doğruluğu bir taramanın ne zaman çalıştığına bağlı değildir.

1. **Uygulama kancaları.** Fiyatı değiştiren her aktif yazma yolu, aynı iş transaction'ı içinde
   `recordPriceChanges` çağırır:
   - seller-panel ürün oluşturma, toplu yükleme, ürün düzenleme (fiyat, kategori, varyant ekleme/güncelleme/silme),
   - varyant hızlı düzenleme,
   - toplu fiyat/stok güncelleme (satır başına bir transaction'a alındı),
   - indirim kuralı oluşturma, güncelleme ve silme (kapsamdaki tüm ürünler).

   Kaydedici ürün başına advisory lock alır, işlem kimliğiyle (`txid`) açıklama yazar ve değişen
   anahtarlar için satır ekler. Admin fiyat değiştiremez.
2. **Kampanya sınırları önceden yazılır.** Kural yazıldığı anda gelecekteki başlangıç (`startsAt`) ve
   bitiş (`endsAt + 1 ms`; `deriveRuleStatus` ile aynı sınır) anlarındaki fiyatlar, kesin zamanlarıyla
   `predicted` satır olarak yazılır. Sonraki her yazma, gelecekteki öngörüleri silmeden `cancelledAt` ile
   iptal eder ve yeniden hesaplar. İki tick arasında başlayıp biten kısa bir kampanya da geçmişe tam
   zamanlarıyla girer. İlk kurulumdaki baseline, o anda var olan kuralların sınırlarını da üretir.
3. **Tetikleyiciler hiçbir değişikliği kaçırmaz.** Seed, CLI, SQL migration, elle düzenleme ve kategori
   silinmesi (`SetNull`) dahil her fiyat ilgili değişiklik bir iz (marker) bırakır.
   - Zamanı gelmiş `SCHEDULED→ACTIVE` ve `ACTIVE→EXPIRED` çevirmeleri fiyatı değiştirmediği için iz
     bırakmaz; türetilmiş durum SQL fonksiyonuyla karşılaştırılır.
   - Aynı işlemde açıklaması olmayan iz **açıklanamayan değişiklik** sayılır.
4. **Açıklanamayan değişiklik güvenilirliği sıfırlar.**
   - Etkilenen anahtarlarda iz anından sonraki satırlar iptal edilir.
   - Güncel fiyat `reconcile` satırı olarak yazılır.
   - `trackedSince` işlem anına çekilir ve anahtar 15 gün yeniden bekler.
   - Sıfırlama bekleyen işlere yayılır: sonuçlanmamış olaylar `cancelled/history_reset` olur,
     kapasite bekleyen alıcılar `skipped/history_reset` olur ve kuyruktaki tüm rezervasyonlar (alıcı
     listesi tamamen kuyruğa yazılmış, yani `dispatched` olaylar dahil) `released/history_reset` olur.
   - Kural izinde temkinli davranılır: satıcının tüm ürünleri sıfırlanır. Kural-ürün izi (bir ürünün
     ürün kapsamlı kurala eklenmesi/çıkarılması, ürün silinmesinin zincirleme silmesi) yalnız o ürünü
     etkiler; artık var olmayan ürün yok sayılır.
5. **Saatlik uzlaştırma** yalnız bir güvenlik ağıdır. Her anahtarın son kayıtlı fiyatı hesaplanan
   fiyata eşit olmalıdır. Fark varsa kancada bir hata vardır ve `reconcile_mismatch` gerekçesiyle
   sıfırlama yapılır.

**Deterministik sıra:**

- Satırlar anahtar içinde `(recordedAt, seq)` ile sıralanır. Aynı anda birden çok satır varsa yalnız en
  yüksek `seq` o anın fiyatıdır; diğerleri **gölgelenmiş** sayılır, minimuma girmez ve olay üretmez.
- Gerçekleşmemiş (`recordedAt > t`) satırlar ve iptal edilmiş öngörüler minimuma girmez ve olay üretmez.

**Bilinçli tercih:** geçmiş ürün yayında olmasa da kaydedilir. Bu, en düşük fiyat hesabını yalnız daha
temkinli yapar.

**Operasyon kuralı:** tetikleyiciler kapalıyken yapılan bir yedekten geri dönüşten sonra
`pnpm price-history:reset --all --reason restore` çalıştırılır.

## 5. Uygunluk (`api/domain/price-drop-eligibility.ts`)

`t` anında `yeni < önceki geçerli fiyat` olduğunda koşullar sırayla kontrol edilir:

| Koşul | Tutmazsa |
|---|---|
| Değişiklik satırı o anın fiyatı (gölgelenmemiş, iptal edilmemiş) | `shadowed` / `cancelled_row` |
| Değişim 24 saatten eski değil | `expired` |
| Ürün herkese açık (yayında, satıcı aktif ve tatilde değil) ve anahtarın stoku > 0 | `not_sellable` |
| `trackedSince ≤ t − 15 gün` | `insufficient_history` |
| Güncel fiyat hâlâ yeni fiyat | `price_changed` |
| `yeni ≤ [t − 15g, t)` penceresinin minimumu (pencere başında yürürlükteki fiyat dahil) | `above_window_min` |

- Eşit minimum uygundur. Fiyat artışı olay üretmez.
- Bir ürünün aynı anda birden çok uygun anahtarı varsa yeni fiyatı en düşük olan `pending` olur;
  diğerleri `grouped` olarak yalnız denetim için tutulur ve e-postada anılmaz.
- İlgili ürün veya satıcı için işlenmemiş iz varken karar verilmez; aday bir sonraki tick'e kalır.

## 6. Dağıtım (`price-history` kuyruğu)

**`tick` (15 sn).** Adımlar sırayla çalışır; her biri ayrı ve sınırlı bir transaction'dır:

1. izleri işle,
2. izlenmeyen ürünlerin baseline'ı,
3. zamanı gelen öngörüleri gerçekleştir,
4. adayları değerlendir,
5. 24 saati aşmış rezervasyonları serbest bırak,
6. bir olayı ilerlet.

**`reconcile` (saatte bir).** İzleri işler, sonra uzlaştırma yapar.

**Olayın ilerlemesi** (`api/services/price-drop-dispatch.service.ts`):

- 24 saatten eski olay ya da artık uygun olmayan olay gerekçesiyle iptal edilir.
- `pending` olay alıcılarını **bir kez dondurur**. Alıcılar, ürünü favorileyen `customer` rollü, banlı
  olmayan kullanıcılardır; satıcının kendi hesabı dahil edilmez. Pazarlama rızası olmayanlar
  `skipped/no_consent` olarak kaydedilir. Dondurmadan sonra favorileyenler bu olaya girmez.
- Bekleyen alıcılar toplu hattın boş yeri kadar işlenir (Faz 5 sabiti: 100 − `pending+queued`).
  - Rezervasyon açılırsa alıcı `reserved` olur ve outbox satırı aynı transaction'da yazılır.
  - Açılamazsa alıcı `skipped` olur ve gerekçe yazılır: `cooldown`, `daily_cap`, `pending_reservation`.
    **Bu karar kesindir;** alıcı aynı olay için bir sonraki gün yeniden denenmez.
  - Yer yoksa alıcılar `awaiting_capacity` olarak bekler. Bu durum limit nedeniyle elenmekten ayrı tutulur.
- Bekleyen alıcı kalmadığında olay `dispatched` olur.

## 7. Rezervasyon, gönderim kapısı ve öncelik

- **Rezervasyon** (`api/services/campaign-email-reservation.ts`). Kullanıcı başına advisory lock altında
  çalışır. Limitlerde yalnız `sending`, `sent` ve `uncertain` kayıtlar sayılır; zaman olarak gerçek
  gönderim anı (`sentAt ?? sendingAt`) kullanılır. `reserved` kayıt yalnız kuyruktaki bir niyettir.
  `released` kayıt hiçbir hakkı tüketmez.
- **Gönderim kapısı** (`api/services/campaign-send-gate.ts`). In-app ve e-posta ayaklarından **önce**
  çalışır:
  - Kuyrukta kalmış eski favori/takip bildirimleri `LEGACY_CAMPAIGN_DISABLED` gerekçesiyle atlanır.
    Politika ve şablonları, eski kayıtlar admin e-posta ekranında okunabilsin diye korunur.
  - Rezervasyonu olmayan kampanya bildirimi gönderilmez (`CAMPAIGN_RESERVATION_MISSING`).
  - Fiyat bildiriminde kapı, önce ürünün ve satıcının bekleyen izlerini satır içinde işler. Kendi
    transaction'ında yeni bir iz görürse karar vermez; iş başarısız sayılır ve BullMQ tekrarı izi önce
    işler. Ardından
    §5'i **bütünüyle** "şimdi" için yeniden çalıştırır: satılabilirlik, 15 günlük güvenilirlik, aynı
    fiyat ve pencere minimumu. Böylece düşüp eski değerine dönen bir fiyat da yakalanır.
  - 7 gün ve 24 saat limitleri, sepet önceliği ve pazarlama rızası kullanıcı kilidi altında atomik
    olarak yeniden kontrol edilir.
  - Kontrol geçmezse rezervasyon gerekçesiyle `released` olur ve iki ayak da üretilmez.
  - Kontrol geçerse rezervasyon `sending` olur. SMTP kabul ederse `sent`; kesin hatada yeniden
    `reserved` olur (BullMQ tekrarı kapıdan yeniden geçer); sonuç belirsizse `uncertain` olur.
    Belirsiz kayıt limitlerde sayılır, otomatik tekrarlanmaz ve admin e-posta ekranında görünür.
- **Sepet önceliği.** Sepet işi karar vermeden önce kuralın kapsamı için izleri, öngörüleri ve adayları
  satır içinde işler.
  - Ürünü favorileyen kullanıcı için bu kampanyadan sonra oluşmuş `pending`, `dispatching` veya
    `dispatched` bir fiyat olayı varsa sepet e-postası yazılmaz (`superseded_by_price_drop`).
  - Kuyruktaki bir sepet rezervasyonu, aynı ürün için fiyat rezervasyonu açılınca serbest kalır.
  - Kapı da aynı kuralı uygular. Bu nedenle sonuç işlerin çalışma sırasından bağımsızdır.
- Bugünkü "önce kayıt yaz, sonra transaction dışında gönder, her hatayı yut" davranışı kapandı. Sepet
  e-postası artık rezervasyon ve outbox satırını tek transaction'da yazar.

## 8. E-posta

| Tip | Alıcı | Hat | Gönderen | Tetik |
|---|---|---|---|---|
| `product_price_drop` | ürünü favorileyen ve pazarlama rızası olan müşteri | `bulk` | `kampanya` (List-Unsubscribe) | dağıtıcı rezervasyonu ve outbox satırını yazar |

- **Konu:** "Favorilediğiniz ürün son 15 günün en düşük fiyatında".
- **Gövde:**
  - "Favorilediğiniz {ürün – varyant} son 15 günün en düşük fiyatında.",
  - ürün görseli,
  - "Güncel fiyat: X TL (KDV dahil)",
  - dipnot: "Kargo ve kişisel kuponlar bu fiyata dahil değildir. Fiyat ve stok değişebilir.",
  - "Ürünü İncele" → `/urun/{slug}?varyant={id}`,
  - "Bu e-postayı, ürünü favorilerinize eklediğiniz için alıyorsunuz." ve abonelikten çıkma bağlantısı.
- Düz metin sürümü de üretilir.
- **Kullanılmayanlar:** üstü çizili fiyat, indirim oranı, "indirim" kelimesi ve diğer varyantlar.
- In-app bildirimin başlığı aynıdır; gövdesi "{ürün} şimdi X TL."

## 9. Ürün sayfası

- `catalog.service.getProductBySlug` varyant fiyatlarını ortak hesapla döndürür. Kural uygulanıyorsa
  varyantın üstü çizili fiyatı kendi taban fiyatıdır. Kural yoksa ürün düzeyindeki liste fiyatı eskisi
  gibi davranır.
- `?varyant={id}` parametresi ürüne ait bir varyantı seçili açar. Canonical `/urun/{slug}` olarak kalır.
  Aynı veri `/api/products/[slug]` üzerinden de etkin varyant fiyatıyla döner.
- Mağaza takip butonu artık indirim bildirimi vaat etmez: "Bu mağazayı takip ediyorsunuz." /
  "Bu mağazayı artık takip etmiyorsunuz."

## 10. Araçlar

- `pnpm price-history:status` salt okunurdur ve kişisel veri içermez. Gösterdikleri:
  - geçmişin başlangıcı,
  - izlenen anahtar sayısı,
  - en erken `trackedSince` ve **ilk olası bildirim zamanı**,
  - 15 günü dolmuş anahtar sayısı,
  - işlenmemiş iz sayısı,
  - son 7 günün sıfırlamaları, olayları, alıcıları ve rezervasyonları.
- `pnpm price-history:reset --all|--product <id>|--seller <id> --reason <kısa-gerekçe>` güvenilirliği
  gerekçeli olarak sıfırlar.

## 11. Test kapsamı

| Dosya | Kapsam |
|---|---|
| `tests/unit/domain/price-drop-eligibility.test.ts` | gölgeleme, gelecekteki ve iptal edilmiş satırlar, pencere başı devri, eşit minimum, artış, tam 15 gün / 1 ms eksik, satılamaz, fiyat değişti, 24 saat, gönderim anında düşüp dönen fiyat, birincil seçimi |
| `tests/unit/domain/effective-price.test.ts` | `deriveRuleStatus` sınırları, sepet aritmetiği, sabit tutarda 0 tabanı, ürün > kategori > tümü önceliği, anahtarlar, sınır anları |
| `tests/unit/catalog-variant-effective-price.test.ts` | ürün sayfası varyant fiyatı = sepet birim fiyatı: kuralsız, çakışan kurallar, başlamadan önce / başlangıç anı / son an / bittikten sonra; üstü çizili fiyat |
| `tests/unit/services/campaign-send-gate.test.ts` | eski türler, rezervasyonsuz, sepet → `sending`, fiyat önceliği, 24 saat sınırı, rıza, işaret → değerlendirme sırası, kapı transaction'ında yeni iz → karar yok (yeniden denenir), geçmiş sıfırlaması, pencere minimumu |
| `tests/unit/email-templates-price-drop.test.ts` | konu, kaçış, yalnız güncel fiyat, bağlantılar, güvensiz görsel |
| `tests/unit/services/campaign-discount.service.test.ts` (yeniden yazıldı) | yalnız sepet kitlesi, önce fiyat hattı sonra karar, öncelik, idempotentlik, limit reddi |
| `tests/integration/campaign-discount-dedupe.test.ts` (yeniden yazıldı) | gerçek rezervasyon modülüyle sepet ↔ fiyat önceliği |
| `tests/security/campaign-respam-cooldown.test.ts` (yeniden yazıldı) | kuyrukta bekleyen, gönderilmiş, belirsiz, süresi dolmuş, serbest bırakılmış rezervasyonlar; 24 saatte 3 |
| `tests/security/campaign-consent-enforcement.test.ts` | rıza kapısı sepet kitlesinde; takip servisi bildirim üretmez |
| `tests/unit/jobs/notification-dispatch.job.test.ts` | eski türler iki ayak da atlanır; reddedilen kapı; `sent` / `failed` / `uncertain` geçişleri |
| `tests/unit/jobs/campaign-discount.job.test.ts` | takipçi fan-out'u yok; hata işi başarısız sayar |
| `tests/integration/api/seller-product-stock-update.test.ts` | varyant rotası kaydediciyi aynı transaction'da çağırır |
| `tests/postgres/price-history.test.ts` | aşağıdaki gerçek veritabanı senaryoları |

**Postgres senaryoları:**

- SQL durum fonksiyonu ↔ `deriveRuleStatus` (64 durum),
- kancalı yazmanın açıklanması; ham SQL yazmasının sıfırlaması ve sonraki satırların iptali,
- zamanı gelmiş durum çevirmesinin iz bırakmaması, duraklatmanın iz bırakması,
- varyant ve kural-ürün izleri; kural kapsamındaki bir ürünün silinmesinin satıcının diğer ürünlerini
  sıfırlamaması (kural-ürün izi yalnız o ürünü etkiler),
- kurulum öncesi kısa kampanyanın baseline'da kesin zamanlarla yazılması ve ilk 15 günde
  `insufficient_history` olması,
- kural düzenlemesinde öngörülerin yenilenmesi,
- aynı anda yazma ile sınırın çakışmasında yazmanın kazanması,
- paralel yazma ve uzlaştırmada bayat satır ve sıfırlama olmaması,
- 3 paralel baseline'da anahtar başına tek satır,
- bekleyen işaretin kararı ertelemesi,
- yalnız favorileyenlerin dondurulması (takipçi, satıcı, admin ve rızası olmayan hariç), sonradan
  ekleneni almaması, kapıdan `sent`,
- kuyruktayken ham SQL değişikliği → gönderim yok, rezervasyon `history_reset`,
- bekleyen alıcılar varken sıfırlama → olay iptal, alıcılar `skipped`,
- düşüp dönen fiyat → gönderim yok,
- günlük sınırın kesin eleme olması ve kapasitenin yalnız bekletmesi,
- paralel dağıtıcılarda alıcı başına tek rezervasyon,
- aynı anda iki gönderimde 24 saatte 3 sınırının aşılamaması,
- fiyat rezervasyonunun sepet rezervasyonunu bırakması.

**Sonuçlar (2026-09-24, yerel):**

- `pnpm lint` 7/7, `pnpm typecheck` 8/8, `pnpm build` 3/3 başarılı.
- `pnpm test` çıkış kodu 0: 232 dosya, 2357 test geçti, 2 atlandı.
- `pnpm --filter @hanuja/tests test:postgres` (iki test veritabanıyla): 7 dosya, 142 test geçti. Bunlara
  finans atomikliği testleri (80) de dahil; tetikleyiciler sipariş ve stok akışlarını bozmadı.

## 12. Yerel doğrulama (2026-09-24)

Yerel `hanuja_dev` üzerinde, SMTP boş bırakılarak (geliştirme JSON transport'u, gerçek e-posta yok)
`outputs/phase6-local-verify.ts` çalıştırıldı. Betik repoya eklenmedi. Geçmişe tarihli fikstür yalnız
yerelde kullanıldı.

- **Ürün:** iki varyantlı (1.000 / 1.249,99 TL). Geçmiş 20 gün önce başladı.
- **Kural:** servis üzerinden %10 ürün indirimi, bitişi 1 saat sonra.
  - Geçmişe `discount_rule_write` satırları ile bitiş anında (`endsAt + 1 ms`) iki öngörü satırı yazıldı.
  - Oluşan 5 iz de `explained` oldu.
- **Değerlendirme:** birincil olay (Doğal, 900 TL) `pending`, diğeri `grouped`.
- **Dağıtım:**
  - Yalnız favorileyen donduruldu; yalnız mağazayı takip eden kitlede yoktu.
  - Rezervasyon açıldı ve kapıdan geçti. Geliştirme transport'u konu satırını logladı; rezervasyon `sent` oldu.
- **Sayfa = sepet:**
  - Doğal: sayfa 900, sepet 900, üstü çizili 1.000.
  - Ceviz: sayfa 1.124,99, sepet 1.124,99, üstü çizili 1.249,99.
- **Tarayıcı:**
  - `?varyant=` Ceviz'i seçili açtı ("1.125 TL", üstü çizili "1.250 TL").
  - Doğal'a geçince "900 TL" ve üstü çizili "1.000 TL" gösterildi.
  - Canonical `/urun/{slug}` olarak kaldı.
- **E-posta:** HTML ve düz metin üretildi: konu, varyant adı, "900,00 TL (KDV dahil)", dipnot, "Ürünü
  İncele" ve çıkış bağlantısı; "indirim" kelimesi ve üstü çizili fiyat yok.
- **Tatil modu:** ilk denemede kullanılan yerel satıcı tatil modundaydı; olaylar doğru biçimde
  `not_sellable` oldu.

Yerelde doğrulanamayanlar:

- **Takip butonunun yeni metni.** Metin giriş yapmış bir oturum gerektiriyor. Değişiklik yalnız metin
  olduğu için typecheck ve build ile doğrulandı.

## 13. Kapsam dışı bulgular (düzeltilmedi)

1. Vitrindeki üstü çizili fiyat (`compareAtPrice` / kural öncesi fiyat), 1 Ağustos 2026'da yürürlüğe
   giren "son 10 günün en düşük fiyatı" referansına göre hesaplanmıyor. Bu fazın fiyat geçmişi ileride
   yapılacak düzeltmeye temel olabilir. Hukuki inceleme önerilir.
2. Favoriler listesi, Meilisearch sonuçları, fiyat filtreleri ve `validateCart` ham (indirim uygulanmamış)
   fiyat kullanıyor. Varyantlı ürün kartları ürün düzeyindeki fiyatı gösteriyor.
3. `catalog.service.bulkUpdatePriceStock` ve `product-import/import.service` commit akışı kullanılmıyor.
   Kancaları yok; bir gün çağrılırsa tetikleyici izi sıfırlamaya yol açar.
4. `price_change_markers` ve `price_change_explanations` için budama henüz yok. Hacim düşük olduğu için
   ileride zamanlanmış bir temizlik eklenebilir.

## 14. Deploy

- Migration yalnız ekleme yapar ve ödemelere dokunmaz; `check-duplicate-payments` gerekmez. Yeni ortam
  değişkeni yok.
- **Sıra:** **worker** (başlarken `pnpm db:migrate:deploy` çalıştırır) → **seller-panel** → **web**.
  - **Worker:** fiyat hattı, dağıtıcı, gönderim kapısı, şablon ve sepet fan-out değişikliği. Worker
    önce gitmeli; aksi hâlde eski worker yeni türü `EMAIL_TEMPLATE_UNSUPPORTED` ile düşürür ve eski
    favori/takip bildirimlerini göndermeye devam eder.
  - **Seller-panel:** ürün, varyant, toplu yükleme ve toplu güncelleme kancaları; indirim kuralı
    servisi. Tetikleyiciler migration ile hemen devreye girer. Seller-panel yeniden dağıtılana kadar
    yapılan yazmaların açıklaması olmaz; bu yazmalar ilgili ürünlerin güvenilirliğini sıfırlar
    (temkinli, beklenen sonuç).
  - **Web:** ürün sayfası varyant fiyatı, `?varyant=` ve takip metni.
  - **Admin-panel:** değişen yollardan yalnız ortak `catalog.service`'i içe aktarır. Admin fiyat
    yazmaz; `getProductBySlug`, sepet ve checkout admin'de kullanılmaz. Bu yüzden yeniden dağıtılması
    gerekmez.
- **İlk uygunluk:** worker'ın ilk tick'i tüm ürünlerin baseline'ını yazar. Güvenilir 15 günlük geçmiş en
  erken baseline + 15 günde oluşur. Bu tarihten önce fiyat e-postası gitmemesi beklenen davranıştır.
