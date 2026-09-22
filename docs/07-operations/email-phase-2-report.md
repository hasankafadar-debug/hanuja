# E-posta Faz 2 — Müşteri ve satıcı sipariş e-postaları

Tarih: 22 Eylül 2026. Faz 1 (`fc19165`) kalıcı outbox + SMTP güvenilirliğini kurmuştu; bu faz
müşteri ve satıcıya gitmesi gereken sipariş e-postalarını eksiksiz, doğru içerikle ve iş
transaction'ı içinde üretir.

Kullanıcı kararları (2026-09-22): kart ödemesinde tek "Siparişiniz Alındı" maili yalnız ödeme
onayından sonra; dokunulan olaylar iş transaction'ına taşınır; canlı gelen kutusu testini
kullanıcı deploy sonrası yapar.

## 1. Bulunan kusurlar ve düzeltmeleri

| # | Kusur (Faz 2 öncesi) | Düzeltme |
|---|---|---|
| 1 | Kart siparişinde "Siparişiniz Alındı" 3DS'ten **önce** gidiyordu; kart reddedilse de müşteri mail alıyordu | `checkout.service` artık yalnız EFT'de mail yazar; kartta mail `payment.service.confirmCardPayment` içinde, ödeme onaylandıktan sonra üretilir |
| 2 | EFT mailinde DB'de banka hesabı varsa `bankTransferInstructions` **dizi** gönderiliyor, şablon nesne bekliyordu → banka/IBAN `-` basılıyordu | Şablon hem tek nesne hem dizi kabul eder; her hesap ayrı blok, IBAN ve referans ile |
| 3 | Teslimat onayı: `eventKey` yok, `orderNumber`/`customerName` yok → e-posta `EMAIL_DATA_MISSING:orderNumber` ile düşüyordu; kısmi onayda hiç bildirim yoktu | `_applyDeliveryConfirmation` tx içinde yazıyor; onaylanan satır kümesinden türeyen deterministik `eventKey`, kısmi/tam ayrımı, teslim tarihi |
| 4 | Müşteri iptali yalnız uygulama içiydi; admin iptali, 20. gün otomatik iptal, EFT reddi ve legacy iptalde **hiç** bildirim yoktu | Yeni `order_cancelled` müşteri şablonu + `cancelOrder`, `rejectEftPayment` ve adet bazlı iptal yollarının tamamı |
| 5 | İade kararları (kargo bilgisi / kabul / kısmi / red / admin inceleme) uygulama içi veya hiç yoktu | Yeni `returnCargoInfoReadyTemplate` ve satır bazlı `returnDecisionTemplate`; satıcı kararı, satıcı reddi, admin inceleme ve admin "teslim alındı" yolları bağlandı |
| 6 | Legacy iade açılışında müşteriye bildirim yoktu, satıcı maili eksik alan yüzünden düşüyordu | `return.service.openRequest` müşteriye mail yazar; satıcı payload'ı `orderNumber`/`items`/`panelUrl` ile tamamlandı |
| 7 | Admin kopyaları (`return_requested`, `order_canceled`) rol politikasına takılıp **başarısız** kayıt üretiyordu | Dispatch: `emailTo` açıkça verilmemiş ve rol eşleşmiyorsa e-posta bacağı hiç açılmaz (uygulama içi bildirim yine oluşur); açık `emailTo` + rol uyuşmazlığı hâlâ hata |
| 8 | Fatura maili `publicNumber` yerine `id.slice(-8)` kullanıyor, satıcı/ürün/fatura linki yoktu | `formatOrderNumber`, satıcı adı, satıcının satırları ve yetkili "Faturayı Görüntüle" linki |
| 9 | Kargo mailinde adet **kümülatif** `shippedQuantity` idi; takip linki yoktu; teslim şablonu HTML kaçışsızdı | Yalnız o sevkiyatın adetleri; doğrulanmış taşıyıcılar için takip linki; tüm şablonlar `escapeHtml` |
| 10 | Hiçbir üretici `recordNotification(tx)` kullanmıyordu (commit sonrası fire-and-forget) | Dokunulan üreticilerin tamamı iş transaction'ı içinde yazıyor (istisnalar §5) |

## 2. Olay → e-posta kataloğu (Faz 2 sonrası)

### Müşteri

| Olay | Tip | Konu | Üretici | eventKey |
|---|---|---|---|---|
| Kart ödemesi onaylandı | `order_placed` | Siparişiniz Alındı — #N | `payment.service` (tx) | `order:{id}:payment-confirmed:customer` |
| EFT siparişi oluştu | `order_placed` | Siparişiniz Alındı — Ödeme Bekleniyor — #N | `checkout.service` (tx) | `order:{id}:created:customer` |
| EFT ödemesi onaylandı | `order_payment_confirmed` | Ödemeniz Onaylandı — #N | `payment.service` (tx) | `order:{id}:payment-confirmed:customer` |
| Kargoya verildi | `order_shipped` | Siparişiniz Kargoya Verildi — #N | `delivery.service.enterTracking` (tx) | `order:{id}:shipped:{sellerId}:{takipNo}` |
| Teslimat onaylandı | `order_delivery_confirmed` | Siparişiniz Teslim Edilmiştir — #N (kısmi: "Bir Kısmı Teslim Edildi") | `delivery.service._applyDeliveryConfirmation` (tx) | `order:{id}:delivery-confirmed:{sha256(satır kümesi)[0..16]}` |
| Fatura yüklendi | `invoice_uploaded` (fatura gönderen) | Faturanız Oluşturuldu — #N | `order-document.service` (tx) | `invoice:{orderId}:{sellerId}:{uploadedAt}` |
| Adet bazlı iptal | `order_cancelled` | Siparişiniz İptal Edilmiştir — #N (kısmi: "Bir Kısmı İptal Edildi") | `quantity-cancellation.service` (tx) | `cancellation:{opId}:customer` |
| Tam sipariş iptali (admin / 20. gün / legacy müşteri / satıcı reddi) | `order_cancelled` | aynı | `order.service.cancelOrder` (tx) | `order:{id}:cancelled:{toStatus}` |
| EFT reddi | `order_cancelled` | Siparişiniz İptal Edilmiştir — #N | `payment.service.rejectEftPayment` (tx) | `order:{id}:cancelled:payment_failure` |
| İade talebi açıldı | `return_requested` | İade Talebiniz Alındı — #N | `quantity-return` (tx) + `return.service` (legacy) | `return:{rrId}:customer:requested` |
| Satıcı iade kargo bilgisini iletti | `return_status_changed` (`stage: cargo_info_ready`) | İade Talebiniz Kabul Edildi — Ürünü Kargoya Verin — #N | `return.service.provideSellerCargoInfo` | `return:{rrId}:customer:cargo-info` |
| İade kararı (tam/kısmi kabul) | `order_return_approved` | İade Talebiniz Kabul Edildi / Kısmen Kabul Edildi — #N | `quantity-return.decideReceipt` (tx), `confirmReceiptBySeller`, admin `reviewRequest` / `markItemReceived` | `return:{rrId}:customer:decision` |
| İade kararı (red) | `order_return_rejected` | İade Talebiniz Reddedildi — #N | aynı + `rejectReceiptBySeller` | `return:{rrId}:customer:decision` |
| Geri ödeme tamamlandı | `refund_completed` | Geri Ödemeniz Yapılmıştır — #N | `refund-notification.service` | `refund:{id}:customer:completed` |

### Satıcı

| Olay | Tip | Konu | Not |
|---|---|---|---|
| Yeni sipariş | `seller_order_received` | Yeni Sipariş — #N | Yalnız ödeme onayından sonra; yalnız o satıcının satırları |
| Sipariş iptali | `order_canceled` | Sipariş İptali — #N | Satıcı **kendi** reddettiğinde kendisine mail gitmez |
| İade talebi | `seller_return_request` | İade Talebi — #N | Müşteri iade açtığında |

### Admin

Bu fazda admin e-postası **yoktur** (Faz 3). Admin kopyaları uygulama içi bildirim olarak kalır ve
artık başarısız e-posta kaydı üretmez.

## 3. Şablon içeriği

- Tek bir `layout()` kabuğu, 580px, mobil `@media` kuralları (görseller 44px'e küçülür).
- Ürün satırları: **görsel + ad + varyant + adet + tutar**. Görsel yoksa hücre boş kalır; görsel URL'i
  `buildManagedMediaShareUrl` ile mutlak hale getirilir, `https` değilse basılmaz.
- Tüm satıcı/müşteri kaynaklı alanlar `escapeHtml`; `javascript:`/`data:` linkler düşürülür.
- Her şablonun düz metin sürümü vardır.
- Sipariş onayı e-postasında tutar dökümü: Ürünler / Kupon İndirimi (kod) / Havale-EFT İndirimi (%) /
  Ek İndirim / Kargo / Toplam.
- Kargo takip bağlantıları `api/domain/cargo-tracking.ts` içindeki **doğrulanmış** sayfalarla sınırlıdır
  (Yurtiçi, Aras, Sürat, MNG→DHL eCommerce, UPS, FedEx, DHL). PTT ve bilinmeyen taşıyıcılarda link
  basılmaz, yalnız takip numarası görünür. Takip numarasında harf/rakam/tire dışı karakter varsa link
  üretilmez.

### Cayma hakkı bloğu (sipariş onayı e-postasının altı, tam metin)

Başlık: **Cayma Hakkınız (14 Gün)**. Punto 12px, renk `#555` (kabuk zemini beyaz).

> Ürünün size veya belirlediğiniz kişiye tesliminden itibaren 14 gün içinde hiçbir gerekçe
> göstermeksizin ve cezai şart ödemeksizin cayma hakkınızı kullanabilirsiniz. Tek siparişte ayrı ayrı
> teslim edilen ürünlerde süre, son ürünün teslimiyle başlar; ürün teslim edilmeden önce de cayma
> hakkı kullanılabilir.
>
> Cayma hakkınızı sipariş detay sayfasındaki "İade Talebi Oluştur" adımından, destek kanallarımızdan
> veya admin@hanuja.com.tr adresine yazarak kullanabilirsiniz. Satıcının anlaşmalı kargo firmasıyla
> yapılan iadelerde kargo ücreti size yansıtılmaz.
>
> Aşağıdaki nitelikteki ürün ve hizmetlerde, mevzuattaki koşullar oluşmuşsa cayma hakkı
> kullanılamayabilir. Satıcıdan ölçü, renk, malzeme uyarlaması veya özel üretim talep ettiğiniz
> ürünler, tüketicinin istekleri doğrultusunda hazırlanan mal sayılır. Ayıplı veya sözleşmeye aykırı
> ürünlere ilişkin yasal haklarınız her durumda saklıdır.

Ardından istisna listesi (`RIGHT_OF_WITHDRAWAL_EXCEPTIONS`, `api/lib/legal-documents.ts` — sözleşme ve
ön bilgilendirme formuyla **aynı kaynak**):

1. Fiyatı finansal piyasalardaki dalgalanmalara bağlı olarak değişen ve satıcı veya sağlayıcının kontrolünde olmayan ürün ve hizmetler.
2. Tüketicinin istekleri veya kişisel ihtiyaçları doğrultusunda hazırlanan mallara ilişkin sözleşmeler.
3. Çabuk bozulabilen veya son kullanma tarihi geçebilecek ürünler.
4. Tesliminden sonra ambalaj, bant, mühür veya koruyucu unsurları açılmış olan ve sağlık/hijyen açısından iadesi uygun olmayan ürünler.
5. Tesliminden sonra başka ürünlerle karışan ve doğası gereği ayrıştırılması mümkün olmayan ürünler.
6. Ambalajı açılmış kitap, dijital içerik ve bilgisayar sarf malzemeleri.
7. Abonelik sözleşmesi kapsamında sağlananlar dışında gazete ve dergi gibi süreli yayınlar.
8. Belirli bir tarihte veya dönemde yapılması gereken konaklama, taşıma, araç kiralama, yiyecek-içecek tedariki ve boş zamanın değerlendirilmesine ilişkin hizmetler.
9. Elektronik ortamda anında ifa edilen hizmetler veya tüketiciye anında teslim edilen gayrimaddi mallar.
10. Cayma hakkı süresi sona ermeden önce tüketicinin onayı ile ifasına başlanan hizmetler.
11. Mevzuatta cayma hakkı dışında bırakılan diğer ürün ve hizmetler.

Blok sonunda sipariş anındaki **Ön Bilgilendirme Formu** ve **Mesafeli Satış Sözleşmesi**
bağlantıları yer alır. Kategori adına bakarak otomatik "iade edilemez" kararı verilmez.

## 4. Sözleşme ve fatura bağlantıları

- Sözleşme: `GET /api/orders/{id}/documents/contracts/{distance-sales|pre-information}` —
  `?goruntule=1` tarayıcıda açar (e-posta linki), parametresiz indirir (mevcut davranış).
- Fatura: `GET /api/orders/{id}/documents/invoices/{sellerId}`.
- Her ikisi de oturumsuz ziyaretçiyi `/giris?callbackUrl=<aynı yol>` adresine yönlendirir; giriş
  sonrası aynı belgeye döner. `callbackUrl` yalnız uygulama içi göreli yol kabul eder
  (`apps/web/src/lib/login-redirect.ts`).
- Sahiplik kontrolü değişmedi: belge yalnız `Order.customerId` eşleşen müşteriye açılır, aksi halde 404.

## 5. Atomiklik — nerede tam, nerede değil

İş transaction'ı içinde yazılan (süreç commit sonrası çökse bile bildirim kaybolmaz):
`checkout.createOrder` (EFT), `payment.confirmCardPayment`, `payment.approveEftPayment`,
`payment.rejectEftPayment`, `delivery.enterTracking` (v2 + legacy), `delivery._applyDeliveryConfirmation`,
`quantity-cancellation.create`, `order.cancelOrder`, `order.sellerReject` (legacy),
`quantity-return.openRequest`, `quantity-return.decideReceipt`, `order-document` fatura yükleme
(manuel + Postmark).

Hâlâ commit sonrası olanlar ve nedeni:
- `refund-notification.service` — geri ödemenin tamamlandığı, sağlayıcı yanıtı alındıktan sonra belli
  olur. Deterministik `eventKey` (`refund:{id}:customer:completed`) tekrar üretimde çift mail önler.
- `return.service` (legacy v1 akışı) — bu servis ardışık yazımlar kullanıyor, tek `$transaction`
  yok. Payload ve `eventKey`'ler düzeltildi; transaction'a taşınması ayrı bir iştir.

## 6. Testler

Yerel çalıştırma (22 Eylül 2026):

- `pnpm lint` → **7/7 görev geçti**.
- `pnpm typecheck` → **8/8 görev geçti**.
- `pnpm test` → **2060 test geçti, 2 atlandı, 0 başarısız** (206 dosya). Faz 1 raporunda "yüklenemiyor"
  denen `tests/security/csrf-route-production.test.ts` bu fazda düzeltildi (aşağıda).
- `pnpm build` → web, seller-panel, admin-panel **başarılı**.
- `tests/postgres/*` **çalıştırılamadı**: yerel test veritabanı parolası bu oturumda mevcut değildi
  (`NOTIFICATION_TEST_DATABASE_URL` girilmedi). Outbox rollback mekanizması Faz 1'de eklendi ve
  değişmedi; mevcut `notification-reliability.test.ts` "iş yazımı + outbox birlikte geri alınır"
  senaryosunu kapsıyor. Deploy öncesi çalıştırılması önerilir.

Yeni test dosyaları:

| Dosya | Kapsam |
|---|---|
| `tests/unit/email-templates-order-lifecycle.test.ts` (15 test) | Her yeni/değişen şablon: konu, görselli/görselsiz satır, kısmi-tam başlık, banka dizisi, tutar dökümü, sözleşme linkleri, cayma bloğu ≥12px, XSS kaçışı, `javascript:` link düşürme, satıcı kapsamı |
| `tests/unit/domain/cargo-tracking.test.ts` (3 test) | Doğrulanmış taşıyıcı linkleri, bilinmeyen taşıyıcı/geçersiz takip numarasında `null`, taşıyıcı etiketi |
| `tests/unit/services/delivery.service.notifications.test.ts` (2 test) | Kargo mailinde bu sevkiyatın delta adedi + takip linki; kısmi → tam teslimat onayında farklı, deterministik `eventKey` |
| `tests/unit/services/quantity-cancellation.notifications.test.ts` (3 test) | Müşteri/satıcı/admin alıcıları, kısmi-tam kapsam, iade tutarı, satıcının kendi reddinde satıcıya mail gitmemesi |
| `tests/unit/services/quantity-return.notifications.test.ts` (2 test) | İade açılış payload'ı; kabul/kısmi/red kararının satır bazlı sınıflandırması ve uyuşmazlık bayrağı |
| `tests/security/order-document-email-links.test.ts` (5 test) | Oturumsuz → `/giris?callbackUrl`, sahiplik kapsamı, `goruntule=1` inline/attachment, başka müşterinin belgesinde 404 |

Güncellenen testler: `email-templates.test.ts` (yeni başlık/etiketler), `notification-dispatch.job.test.ts`
(+4 test: rol atlama, stage filtresi, yeni şablonlar, geçersiz karar değeri), `payment.service.notifications.test.ts`
(tx client ile yazım, kart→`order_placed` / EFT→`order_payment_confirmed`), `payment-eft-approval.test.ts`,
`order-document-alias.service.test.ts` (fatura payload + tx rollback'te dosya temizliği),
`integration/api/payment-confirm-binding.test.ts` (fixture'a tutar alanları + outbox).

Test altyapısı düzeltmeleri: `tests/__mocks__/prisma-client.ts` → `Prisma.TransactionIsolationLevel`,
`tests/__mocks__/prisma-runtime.ts` → `Decimal.isFinite()` / `decimalPlaces()`.
`tests/security/csrf-route-production.test.ts` artık yükleniyor (kendi `@prisma/client` mock'una
`NotificationType` + `Prisma` eklendi) ve ceza servisi mock'lanarak 15/15 geçiyor — dosya Faz 1'den
beri hiç çalışmıyordu.

## 7. Deploy

- **Migration YOK, yeni env YOK.** Kullanılan tüm `NotificationType` değerleri enum'da mevcuttu.
- **Dört servis de yeniden dağıtılmalı:** worker (dispatch + şablonlar), admin-panel (teslimat onayı,
  iptal, EFT onay/red, iade inceleme), seller-panel (kargo, fatura, iade kararı), web (checkout,
  ödeme callback, iade, sözleşme/fatura route'ları).
- **Sıra: worker → admin-panel → seller-panel → web.** Worker önce olmalı: yeni tipler
  (`order_cancelled`, `order_return_approved/rejected`, stage'li `return_status_changed`) eski
  worker'da `EMAIL_TEMPLATE_UNSUPPORTED` ile beş denemede düşer. Migration ve kuyruk payload şeması
  değişmediği için başka sıra riski yoktur.
- Deploy'u kullanıcı tetikler (dört serviste "Manual deployments only").

## 8. Deploy sonrası canlı doğrulama (kullanıcı)

Test müşteri + test satıcı hesabıyla:

1. EFT siparişi oluştur → "Siparişiniz Alındı — Ödeme Bekleniyor" (banka blokları dolu mu, sözleşme
   linkleri giriş sonrası belgeyi açıyor mu, cayma bloğu okunuyor mu).
2. Admin EFT onayı → müşteriye "Ödemeniz Onaylandı", satıcıya "Yeni Sipariş".
3. Satıcı kargo bilgisi girer → müşteriye "Siparişiniz Kargoya Verildi" (adet = bu sevkiyat, takip
   linki çalışıyor mu).
4. Satıcı fatura yükler → "Faturanız Oluşturuldu", "Faturayı Görüntüle" linki.
5. Admin teslimat onayı (önce kısmi, sonra kalan) → iki ayrı mail, başlıklar farklı.
6. Müşteri adet iptali → müşteriye "Bir Kısmı İptal Edildi", satıcıya "Sipariş İptali".
7. İade aç → kargo bilgisi → kısmi kabul → geri ödeme tamamlandığında "Geri Ödemeniz Yapılmıştır".
8. Her adımda admin `/e-posta` ekranında kaydın `sent` (ve Resend webhook'u kuruluysa `delivered`)
   olduğunu doğrula.

Canlı gelen kutusu kabulü bu rapora kullanıcı beyanıyla eklenecektir; bu faz canlı doğrulama
yapılmadan "tamamlandı" sayılmaz.

## 9. Geri dönüş

Şema değişikliği yoktur; geri dönüş yalnız önceki commit'e deploy'dur. Worker eski sürüme alınırsa
yeni tipteki bekleyen outbox kayıtları `EMAIL_TEMPLATE_UNSUPPORTED` ile başarısız olur — bu durumda
üreticileri (web/admin/seller) de birlikte geri almak gerekir. Bekleyen outbox verisi silinmemelidir.

## 10. Bu fazda kapsanmayanlar

- Admin operasyon e-postaları (7 olay) — Faz 3.
- "Soru Sor" konuşmaları — Faz 4; duyurular — Faz 5; 15 günün en düşük fiyatı — Faz 6.
- Uyuşmazlık açılış/çözüm bildirimi (`dispute_opened` / `dispute_resolved`) hâlâ uygulama içi;
  müşteri, iade reddi mailinde uyuşmazlığın açıldığını öğrenir, ancak uyuşmazlık **sonucu** için
  ayrı e-posta yoktur.
- Admin'in başlattığı iade akışı repoda yok; satıcıya "İade Talebi" maili yalnız müşteri açılışında
  gider.
- `markDelivered` (`delivered` durumu) hâlâ hiçbir route tarafından çağrılmıyor; `order_delivered`
  tipi kullanılmıyor. Müşteriye teslim maili `delivery_confirmed` anında gider.
- `return.service` (legacy) bildirimleri transaction dışında kalmaya devam ediyor (§5).
