# E-posta Faz 4 — "Soru Sor" ve Hanuja aracılı ürün soruları

**Tarih:** 23 Eylül 2026
**Kapsam:** müşterinin ürün sayfasından veya siparişinden ürün sorusu sorması, tasarımcının panelden iç
yanıtı, Hanuja'nın müşteriye ve tasarımcıya yanıtı, bu yanıtların e-posta ve uygulama içi bildirimleri ve
adminin denetimli erişimi. Faz 1 (kalıcı gönderim), Faz 2 (sipariş e-postaları) ve Faz 3 (admin operasyon
e-postaları) üzerine kurulur. Ayrıca giriş sayfasındaki `callbackUrl` açık yönlendirme açığı ayrı bir commit
ile kapatıldı.

> **Güncelleme (2026-10-17).** 12 Ekim 2026 `436c0eb` ("feat: make Hanuja the customer-facing seller") ile ürün
> soruları Hanuja aracılı modele geçti: müşteri ve tasarımcı birbirine yazmaz (`docs/07-operations/hanuja-seller-model.md`,
> "İletişim"). Bu raporun 23 Eylül'deki doğrudan müşteri↔tasarımcı e-posta modeli şu bölümlerde güncellendi:
> Kapsam, §2 (iki karar), §5 (yazma yolları), §6 (eşzamanlılık ve olay anahtarı), §7 (okundu), §8 (olay kataloğu),
> §9 (admin satırı), §12 (concurrency testi). `product_question_messages.audience` kolonu §3'te anlatılmaz; o kolon
> `20261012150000_hanuja_seller_model` migration'ında eklendi. §1, §3, §4, §10, §11 ve §13 (23 Eylül doğrulama
> kaydı) değişmedi veya tarihseldir.
>
> **Güncelleme (2026-10-17, tasarımcı bildirimi).** Tasarımcı artık kendi ürünündeki müşteri mesajlarını müşterinin
> kimliği olmadan görür ve her müşteri mesajında bir e-posta + uygulama içi bildirim alır; okunmamış sayısı menü
> rozetinde ve kontrol panelindeki "Ürün Soruları" kartında görünür. Tasarımcının yanıtı yine yalnız Hanuja'ya
> gider. §2, §6, §7, §8 ve §9 buna göre güncellendi.

---

## 1. Neden

Faz 4 öncesinde müşterinin satıcıya doğrudan ulaşabileceği bir kanal yoktu. Mevcut konuşma
modellerinin hiçbiri bu işe uymuyordu:

| Model | Taraflar | Neden uymuyor |
|---|---|---|
| `CustomerSupportTicket` | müşteri ↔ admin | satıcı yok, siparişe zorunlu bağlı |
| `SupportTicket` | satıcı ↔ admin | müşteri yok |
| `ReturnMessage` | müşteri ↔ satıcı | yalnız bir iade talebinin içinde |

Admin destek biletleri **değiştirilmedi**; satıcıya yönelen sorular yeni konuşma akışına alındı.

---

## 2. Kullanıcı kararları (2026-09-23)

- Butonlar: ürün sayfasında solda **Ürünü Paylaş**, sağda **Soru Sor** (eşit genişlik).
- ~~Admin konuşmaları **yalnız okur**; admin mesaj yazamaz.~~ → 2026-10-12'den beri admin, yanıtında hedef
  (müşteri veya tasarımcı) seçerek yazabilir; iç not yoktur. Her görüntüleme ve her yanıt denetim günlüğüne yazılır.
- ~~E-posta **sıra değişiminde** gider: karşı taraf yanıt verene kadar gelen ardışık mesajlar tek e-posta üretir.~~
  → Geçersiz. 2026-10-17'den beri her müşteri mesajı tasarımcıya bir e-posta üretir; tasarımcı mesajı e-posta
  üretmez; Hanuja yanıtı alıcısına bir e-posta üretir (§8).
- İletişim bilgisi paylaşımı (e-posta, telefon, IBAN, bağlantı, sosyal medya, adres) **engellenir**.
- Giriş `callbackUrl` doğrulaması bu fazda, ayrı küçük commit ile.

---

## 3. Veri modeli

Migration `20260923120000_product_questions` (additive):

- `enum ProductQuestionStatus { waiting_for_seller, waiting_for_customer }`
- `product_question_threads`: `threadKey` (**unique**), `customerId`, `sellerId`, `productId`,
  `orderId?` (SetNull), `status`, `turnSeq`, `messageSeq`, `lastCustomerMessageSeq`,
  `lastSellerMessageSeq`, `customerLastReadSeq`, `sellerLastReadSeq`, `lastMessageAt` (yalnız
  gösterim ve liste sıralaması).
- `product_question_messages`: `threadId` (Cascade), `seq` (`@@unique([threadId, seq])`), `authorId`,
  `authorRole`, `body` (text), `createdAt`.
- Enum ekleri `ADD VALUE IF NOT EXISTS` ile yazılır (yeniden uygulama zararsız).
- `NotificationType` + `seller_product_question`, `customer_product_question_answered`;
  `AdminActionType` + `product_question_viewed`.

**Tekillik:** `threadKey = "{customerId}:{productId}:{orderId | presale}"`. Anahtar `orderId` boşken
de benzersizdir (NULL karşılaştırmasına veya PostgreSQL sürümüne dayanmaz). Satış öncesi soru ile aynı
ürünün sipariş sorusu ayrı konuşmadır.

**Silme yolları:** ürün ve satıcı FK'leri `RESTRICT`. Sipariş geçmişi olmayan ürünün/satıcının admin
tarafından silinmesi (`catalog.deleteProductForAdmin`, `admin-seller-management.deleteSeller`) artık
ilgili satış öncesi konuşmaları da açıkça siler. Sipariş geçmişi olan ürün/satıcı zaten silinemez.

---

## 4. Açma kuralları (iki ayrı küme)

| | Satış öncesi (`orderId` yok) | Siparişe bağlı |
|---|---|---|
| Ürün durumu | `published` olmalı | **aranmaz** (yayından kalkmış ürün için de sorulabilir) |
| Satıcı | `active`, tatilde değil | `active` veya `suspended` |
| Doğrulama | ürün + satıcı | müşteri + sipariş + ürün + satıcı **tek sorguda**: sipariş müşterinin, ödeme onaylı (satıcıya görünür), `orderLine { productId }` var |
| `sellerId` kaynağı | ürün | **sipariş satırı** |
| Ortak | kullanıcı rolü `customer`; kendi ürününe soru yok | |

**Yanıt:** askıya alınmış satıcı mevcut tüm konuşmalarına yanıt verebilir (`getOperationalSellerIdOrThrow`).
Satıcı operasyonel değilse müşteri tarafı salt okunur olur.

Arayüz: sipariş sayfasında **her ürün satırında** "Satıcıya Soru Sor" vardır; satıcı grubunun ilk
ürünü sessizce seçilmez. Buton yalnız ödemesi onaylı siparişte görünür; sunucu yine de her şeyi
yeniden doğrular.

---

## 5. Mesaj metni — dört yazma yolunda tek kapı

`prepareQuestionMessageBody` (`api/services/product-question.service.ts`) soru, müşteri yanıtı, tasarımcı
yanıtı ve Hanuja yanıtı için **aynı** kontrolü uygular: `trim()` → 2–2000 karakter → `assertNoContactSharing`. Saklanan
metin her zaman bu fonksiyonun çıktısıdır; böylece ilk soruda engellenen bilgi yanıtta paylaşılamaz.
Route katmanındaki zod yalnız kaba bir üst sınırdır (4000).

---

## 6. Eşzamanlılık

- **Konuşma açma:** `create` benzersiz anahtara takılırsa (`P2002`) istek **yeni bir transaction**da
  kazanan konuşmaya mesaj ekler; ikinci bir konuşma açılmaz. Eklenen mesaj normal kurala göre bildirilir.
- **Mesaj sırası (kilit altında):** `appendProductQuestionMessage` ilk iş olarak konuşmanın
  `messageSeq` sayacını artırır; bu güncelleme satır kilidini alır. Mesajın `seq`'i, zaman damgası,
  tur sayacı (`turnSeq`) ve "son mesaj" alanları bu kilit altında yazılır. Her müşteri ve tasarımcı
  mesajı yeni bir tur açar ve her admin kullanıcısı için bir uygulama içi kopya yazar (e-posta yok). Müşteri
  mesajı ayrıca tasarımcıya bir bildirim yazar ve `lastCustomerMessageSeq`'i mesajın `seq`'ine taşır.
  `replyAsAdmin` de aynı kilidi alıp `messageSeq` ve `turnSeq`'i artırır. Paralel yazıcılar kilit
  sırasına göre seri hâle gelir: sıra numaraları commit sırasını izler ve hiçbir yazma bir sınırı
  geriye taşıyamaz. `lastMessageAt` gösterim içindir; `appendProductQuestionMessage` onu kayıtlı
  değerin gerisine düşürmez (sunucular arası saat farkı), `replyAsAdmin` bu korumayı uygulamaz (bilinen sınır).
- **Olay anahtarı (e-posta):** `product-question:{threadId}:admin-reply:{messageId}` — her Hanuja yanıtı en
  çok bir e-posta ve bir uygulama içi bildirim üretir; anahtar mesaj kimliğine bağlıdır. Müşteri ve
  tasarımcı mesajlarının admin kopyaları: `product-question:{threadId}:admin:{adminId}:turn:{turnSeq}:{customer|seller}`
  (e-posta yok). Müşteri mesajının tasarımcı bildirimi: `product-question:{threadId}:customer-message:{messageId}` —
  mesaj başına en çok bir e-posta. Eski `product-question:{threadId}:{seller|customer}:turn:{turnSeq}` anahtarı
  artık yazılmaz.
- Bildirim atlanacaksa outbox satırı **hiç yazılmaz** (worker `emailTo` yokken `user.email`'e düştüğü
  için yalnız `emailTo`'yu atlamak e-postayı durdurmaz).

Gerçek PostgreSQL testleriyle doğrulandı (2026-09-23 kaydı; o tarihte bildirim kararı kilit altında verilirdi,
2026-10-12'den beri her mesaj tur açar). Mutasyon kontrolü: bildirim kararı kilitten önce okunan
duruma dayandırılınca iki paralel test düştü, geri alınınca geçti. (İlk sürümdeki koşullu `updateMany`
claim'i de aynı testlerde doğrulanmıştı; inceleme sonrası kilit-önce sıra modeline geçildi.)

---

## 7. Okundu bilgisi

- Okunmamış ve okundu sınırları **mesaj sıra numarasıdır**, saat değil: okunmamış = izleyene görünen son
  karşı taraf mesajının `seq`'i > izleyenin okundu `seq`'i. Müşteri için bu `lastSellerMessageSeq` (Hanuja → müşteri);
  tasarımcı için `lastCustomerMessageSeq` (müşteri mesajı veya Hanuja → tasarımcı) alanıdır. Tasarımcı mesajları
  sayaçları değiştirmez. 2026-10-17 öncesi müşteri mesajları geri doldurulmadı; tasarımcıya okunmamış görünmez. Kilit sayesinde görünür mesajlar her zaman bir önektir; geç
  görünür olan mesaj daima daha büyük `seq` alır ve okundu sınırının gerisinde kalamaz.
- Sunucu render'ı ve bağlantı prefetch'i okundu **yazmaz**.
- Konuşma ekranı yerleşip sekme görünürken istemci, **ekranda gösterilen son mesajın** kimliğiyle
  `POST …/read` gönderir (müşteri: `/api/product-questions/:id/read`, satıcı:
  `/api/seller/product-questions/:id/read`).
- Sunucu mesajın o konuşmaya, konuşmanın görüntüleyene ait olduğunu ve mesajın görüntüleyene görünür olduğunu
  (`isProductQuestionMessageVisibleTo` ile aynı kural) tek sorguda doğrular (aksi 404),
  sınırı mesajın `seq`'ine taşır ve **geri götürmez** (`xLastReadSeq < seq` koşulu).
- Mesaj göndermek okundu sınırını değiştirmez. Admin görüntülemesi okundu yazmaz.
- Tasarımcı menüsündeki rozet ve kontrol panelindeki "Ürün Soruları" kartı aynı sayıyı gösterir: okunmamış müşteri
  veya Hanuja mesajı olan konuşma sayısı (`countUnreadForSeller`: konuşma sayar, mesaj saymaz). Kart 1 ve üstünde
  sarıdır (`StatCard tone="warning"`). Tasarımcının kendi mesajları sayıyı değiştirmez.
- **Yeniden deneme:** okundu isteği ortak `startReadReceipt` (`packages/ui/src/lib/read-receipt.ts`)
  ile gönderilir. Başarılı istek bir daha gönderilmez; yalnız geçici hatalar (ağ hatası, 429, 5xx)
  toplam 3 denemeye kadar, artan gecikmeyle (1 sn, 3 sn; 429'da `Retry-After`, en çok 30 sn) yeniden
  denenir; 400/401/403/404/422 denenmez. Sayfa gizliyken gönderilmez, görünür olunca devam eder;
  bileşen kapanınca bekleyen deneme iptal edilir.
- `advanced: false` hata değildir: aynı veya daha eski bir mesaj zaten okunmuşsa beklenen sonuçtur.

---

## 8. Olay kataloğu

Müşteri mesajı tasarımcıya, Hanuja yanıtı alıcısına e-posta üretir; tasarımcı mesajı e-posta üretmez.

| Olay | Tip | Alıcı | Konu / gövde | eventKey | Bağlantı |
|---|---|---|---|---|---|
| Müşteri soru sorar veya yazar | `seller_product_question` | tasarımcı (`seller.user.email`) | **Müşteri Sorusu — {ürün}**; "Bir müşteriniz … soru sordu", müşteri adı yok | `product-question:{threadId}:customer-message:{messageId}` | `{satıcı paneli}/musteri-sorulari/{threadId}` |
| Hanuja müşteriye yanıt verir (`replyAsAdmin`, hedef `customer`) | `customer_product_question_answered` | müşteri (`customer.email`) | **Sorunuz yanıtlandı — {ürün}**; gövde "Hanuja, … sorunuzu yanıtladı" | `product-question:{threadId}:admin-reply:{messageId}` | `{web}/hesabim/sorularim/{threadId}` |
| Hanuja tasarımcıya yanıt verir (`replyAsAdmin`, hedef `seller`) | `seller_product_question` | tasarımcı (`seller.user.email`) | **Müşteri Sorusu — {ürün}** (gövde için aşağıdaki açık nokta) | `product-question:{threadId}:admin-reply:{messageId}` | `{satıcı paneli}/musteri-sorulari/{threadId}` |
| Müşteri veya tasarımcı mesajı (her tur) | `admin_support_new_ticket`; yalnız admin kullanıcılarının uygulama içi kopyası | yok; e-posta bacağı kapalı | "Hanuja ürün sorusu" / "Tasarımcı iç yanıtı" | `product-question:{threadId}:admin:{adminId}:turn:{turnSeq}:{customer\|seller}` | `/musteri-sorulari/{threadId}` (admin paneli) |

Her e-posta alıcı için bir uygulama içi bildirimle birlikte gelir (aynı olay anahtarı). Tasarımcı e-postasında
müşterinin adı ve e-postası yoktur: müşteri mesajında "Müşteri" satırı hiç basılmaz, Hanuja yanıtında "Hanuja"
yazar.

Şablonlar (`api/lib/email-templates/product-questions.ts`): HTML + düz metin, ürün görseli (güvenli https ise),
400 karakterlik alıntı (`escapeHtml`, satır sonları korunur), konuşma ekranına CTA ve "yanıt e-postayla değil
panelden verilir" notu.

**Açık nokta — Hanuja'nın tasarımcıya yanıtı:** aynı şablon kullanıldığı için bu e-posta da "Müşteri Sorusu",
"Merhaba Hanuja," ve "Bir müşteriniz … soru sordu" metniyle gider. Metin kararı bekleniyor.
Kuyruk: `noreply` → işlemsel `notification-dispatch`.

---

## 9. Ekranlar

| Yüzey | Yol | Not |
|---|---|---|
| Storefront ürün sayfası | `/urun/[slug]` | Ürünü Paylaş / Soru Sor; oturumsuz tıklama `/giris?callbackUrl=/urun/{slug}?soru=1`, dönüşte form açık |
| Storefront sipariş | `/siparis/[id]` | satır başına "Satıcıya Soru Sor" |
| Müşteri hesabı | `/hesabim/sorularim?sayfa=N`, `/hesabim/sorularim/[id]` | menüde **Sorularım**; 30'luk sayfalar |
| Satıcı paneli | `/musteri-sorulari?durum=…&sayfa=N`, `/musteri-sorulari/[id]` | "Siparişler" bölümünde, okunmamış rozeti; listede tasarımcının ürünlerine ait tüm konuşmalar ve müşteri mesajları yer alır (müşteri "Müşteri" olarak, kimliksiz); kontrol panelinde okunmamış sayılı "Ürün Soruları" kartı; askıdaki satıcıda da görünür; 30'luk sayfalar, filtre sayfalar arasında korunur |
| Admin paneli | `/musteri-sorulari`, `/musteri-sorulari/[id]` | liste yalnız üst veri (mesaj içeriği yok); detayda konuşma okunur (her görüntüleme audit'lenir) ve `AdminCommunicationReply` ile müşteriye veya tasarımcıya yanıt yazılır (hedef seçilir, iç not yok); detay bağlantısında prefetch kapalı |

Gizlilik metni (soru formu, müşteri listesi): "Konuşma herkese açık değildir. Siz, ilgili satıcı ve denetim
amacıyla yetkili yöneticiler erişebilir." Satıcı listesi 2026-10-17'den beri: "Müşterinin kimliği gösterilmez;
yanıtınız Hanuja'ya iletilir ve müşteriye Hanuja yanıt verir."

Listeler sayfalıdır (`PRODUCT_QUESTION_PAGE_SIZE = 30`, `lastMessageAt desc, id desc`, aralık dışı sayfa
son sayfaya çekilir); 100'den fazla konuşmada en eski konuşma son sayfada erişilebilir.

**İstek gövdesi:** route'lar gövdeyi `readJsonBody` (`api/lib/request-body.ts`) ile okur. Boş veya bozuk
JSON → `400 INVALID_JSON`; istemci bağlantıyı kestiyse → `499 REQUEST_ABORTED` (sunucu hatası olarak
loglanmaz); başka bir okuma hatası ve gövde okunduktan sonraki servis/veritabanı hataları 500 olarak kalır.

Route sırası (tüm yazma/okundu route'ları): **CSRF → IP limiti → oturum → kullanıcı limiti → işlem.**
Limitler: yeni soru 5/saat, yanıt 20/10 dk, okundu 60/dk, IP 60/dk.

---

## 10. Giriş `callbackUrl` doğrulaması (ayrı commit)

`safeInternalPath` (`apps/web/src/lib/login-redirect.ts`) — giriş sayfası ve `loginRedirectUrl` bunu
kullanır. Kurallar: yalnız `/` ile başlayan, `//` ile başlamayan; ters eğik çizgi / kontrol karakteri
yok; `decodeURIComponent` sonrası da aynı kurallar (kodlanmış ayraçlar `%2F`, `%5C` reddedilir); yolda
`.`/`..` segmenti yok (kodlu `%2e` dahil); `new URL` ile origin değişmemeli; **normalize edilmiş çıktı
yeniden doğrulanır** ve idempotent olmalı. Böylece `/a/..//evil.com` → `//evil.com` normalizasyon
açığı oluşmaz. Geçersiz değer `/hesabim`'e düşer.

---

## 11. Bilinen sınırlar

- Ek dosya, konuşma kapatma/gizleme ve herkese açık soru-cevap listesi kapsam dışı.
- Satıcı yanıt gecikmesi için SLA/hatırlatma yok.
- Admin liste ekranı satıcıya göre filtreyi yalnız `?satici=` parametresiyle destekler (arayüz alanı yok).

---

## 12. Test kapsamı

**Birim (yeni)**
- `tests/unit/login-redirect.test.ts` — 30 test (açık yönlendirme girdileri, kodlu ayraçlar, nokta segmentleri, özellik testi).
- `tests/unit/domain/product-question.test.ts` — 6 test (okunmamış kuralı sıra numarasıyla).
- `tests/unit/services/product-question.service.test.ts` — 27 test (üç yazma yolu, iki açma kural seti, kilit-önce sıra ve tur kararı, okundu, sayfalama).
- `tests/unit/email-templates-product-questions.test.ts` — 4 test.

- `tests/unit/read-receipt.test.ts` — 13 test (başarıda tek gönderim, 500/503/ağ hatası yeniden deneme ve
  deneme sınırı, 429 `Retry-After`, 4xx'te yeniden deneme yok, gizli sayfada bekleme, iptal).
- `tests/unit/lib/request-body.test.ts` — 7 test (boş/bozuk JSON → 400, kesilen istek → 499, diğer okuma hatası aynen).

**Birim (güncellenen):** `tests/unit/jobs/notification-dispatch.job.test.ts` (+2: render, rol uyuşmazlığı).

**Güvenlik (yeni):** `tests/security/product-question-routes.test.ts` — 14 test (guard sırası, CSRF,
429, müşteri/satıcı sahiplik, askıdaki olmayan satıcı, satıcı DTO'sunda e-posta yok, admin audit,
admin listesinde içerik yok, beş route'ta bozuk gövde → 400 `INVALID_JSON`, gerçek DB hatası → 500).

**PostgreSQL (yeni; 2026-10-17'de tasarımcı bildirimine göre güncellendi):**
`tests/postgres/product-question-concurrency.test.ts` — eşzamanlı iki ilk soru → 1 konuşma / 2 mesaj, mesaj başına
bir admin kopyası ve tasarımcıya mesaj başına bir e-posta (müşteri kimliği yok), tasarımcıda 1 okunmamış konuşma;
eşzamanlı müşteri mesajları → kilit sırasıyla seri, her biri tur açar (`turnSeq` her mesajla +1), tasarımcıya
mesaj başına bir e-posta, `lastCustomerMessageSeq` en yeni müşteri mesajında; eşzamanlı tasarımcı yanıtları →
e-posta yok, tasarımcıya da bildirim yok; eşzamanlı Hanuja yanıtları → yanıt başına bir müşteri e-postası,
tasarımcı bu yanıtları görmez; satış öncesi ve sipariş konuşmalarının ayrılması; outbox hatasında rollback; okundu
sınırının monotonluğu, yabancı mesaj ve Hanuja'nın müşteriye yanıtı için tasarımcı okundusunun reddi; **ters
tamamlanma** (A kilidi alıp commit etmeden bekler, B ve bir okundu isteği arkasında bekler → seq'ler boşluksuz,
B > A, `lastMessageAt` geri gitmez, arada yapılan okuma yeni mesajları okunmamış bırakır); **101 konuşma** (30'luk
4 sayfa, en eski konuşma son sayfada, aralık dışı sayfa son sayfaya çekilir).

---

## 13. Yerel tarayıcı doğrulaması (2026-09-23)

Üç panel yerelde çalıştırıldı; girişleri kullanıcı yaptı (şifreler ajan tarafından girilmez).

| Kontrol | Sonuç |
|---|---|
| Oturumsuz "Soru Sor" → giriş → dönüş | `/giris?callbackUrl=/urun/…?soru=1` → girişten sonra aynı ürün, form açık, metin kutusu odakta, `?soru=1` temizlendi |
| İletişim bilgisi | telefon içeren soru formda reddedildi ("İletişim bilgisi paylaşamazsınız…") |
| Soru gönderimi | `/hesabim/sorularim/{id}`'ye yönlendi; outbox `…:seller:turn:1` |
| Satıcı rozeti | 1; müşteri adı "Playwright M." (maskeli) |
| Prefetch / sunucu render | detay için RSC prefetch, tam RSC ve tam HTML isteği sonrası `sellerLastReadSeq = 0` (rozet düşmedi) |
| Ekranda okundu | detay açılınca `POST …/read` → sınır 1, rozet temizlendi |
| Satıcı yanıtı | seq 2, `waiting_for_customer`; outbox `…:customer:turn:2` |
| Müşteri "Yeni yanıt" | listede görünür; konuşma açılınca `customerLastReadSeq = 2` |
| Sipariş satırından soru | ayrı konuşma (`orderId` dolu); yönlendirme sonrası okundu 1 |
| Başka müşteri / satıcı konuşması | yazma ve okundu 404; sayfa var olmayan kimlikle aynı not-found ekranı (içerik sızmaz; dinamik sayfalarda HTTP 200) |
| Admin | liste içerik taşımaz; detay salt okunur, form yok; tek görüntüleme = 1 `product_question_viewed` satırı; Denetim Günlüğü'nde "Müşteri sorusu görüntülendi"; okundu sınırları değişmedi |
| `callbackUrl=/\evil.com` ile gerçek giriş | `/hesabim`'e yönlendi |
| Satıcı logu `useRef` hatası | bu oturumdaki satıcı isteklerinin hiçbirinde yok (§26 kaydı yerelde güncel koddan üretilmiyor) |

**Strict CSRF (`CSRF_STRICT=true`, web ve satıcı paneli):**

| İstek | Sonuç |
|---|---|
| Müşteri ekranında okundu (`csrfFetch`) | 200 |
| Müşteri formundan yanıt | 201 |
| Yeni soru, token'lı | 201 |
| Müşteri yanıtı / okundu / yeni soru, **token'sız** | 403 "CSRF doğrulaması başarısız…" |
| Satıcı ekranında okundu | 200 |
| Satıcı formundan yanıt | 201 |
| Satıcı yanıtı / okundu, **token'sız** | 403 |

Gözlemler:
- Varsayılan yerel modda CSRF'siz POST kabul edildi (201): `checkCsrf` geliştirme modunda `CSRF_STRICT`
  olmadan bilinçli olarak devre dışı. Strict modda reddi yukarıdaki tabloda doğrulandı.
- Sayfadan ayrılınca kesilen bir okundu isteği önceden boş gövdeyle 500 üretiyordu; artık `readJsonBody`
  ile 499/400 olarak sınıflandırılır.
- **Açıklanamayan kayıt:** müşterinin ilk konuşma ziyaretinde bir okundu isteği 200 döndü, ancak sonraki
  sorguda `customerLastReadSeq = 0` görüldü. İsteğin gönderdiği mesajın sıra numarası ve işlem öncesindeki
  okunma sınırı kaydedilmediği için `advanced: false`'un beklenen bir sonuç mu yoksa bir hata mı olduğu
  kanıtlanamadı; neden atfedilmiyor. Aynı yol (soru gönder → yönlendirme, liste → detay) üç kez daha
  izlendi ve her seferinde sınır doğru ilerledi.
- Test verisi (konuşmalar, outbox/bildirim satırları, yerel sipariş) silindi; test satıcısının tatil modu geri
  açıldı. Denetim kaydı append-only olduğu için bırakıldı.

---

## 14. Deploy

- **Migration var:** `20260923120000_product_questions`. Ödeme benzersizliğine dokunmaz →
  `check-duplicate-payments` gerekmez.
- **Yeni env yok.**
- `packages/ui`: yalnız ekleme (`startReadReceipt`); web ve seller-panel kullanır.
- Sıra: `pnpm db:migrate:deploy` → **worker → admin-panel → seller-panel → web**. Dördü de etkilenir:
  worker yeni şablonları render eder (eski worker yeni tipleri `EMAIL_TEMPLATE_UNSUPPORTED` ile düşürür),
  admin/seller/web yeni ekran ve route'ları taşır.
- Geri dönüş: kod geri alınabilir; tablolar additive olduğundan eski kod onları yok sayar. Enum değerleri
  PostgreSQL'de geri alınamaz ama zararsızdır.
