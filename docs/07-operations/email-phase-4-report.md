# E-posta Faz 4 — "Soru Sor" ve özel müşteri–satıcı konuşmaları

**Tarih:** 23 Eylül 2026
**Kapsam:** müşterinin ürün sayfasından veya siparişinden satıcıya özel soru sorması, satıcının
panelden yanıtlaması, iki yönlü e-posta bildirimi ve adminin salt okunur, denetimli erişimi.
Faz 1 (kalıcı gönderim), Faz 2 (sipariş e-postaları) ve Faz 3 (admin operasyon e-postaları) üzerine
kurulur. Ayrıca giriş sayfasındaki `callbackUrl` açık yönlendirme açığı ayrı bir commit ile kapatıldı.

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
- Admin konuşmaları **yalnız okur**; her görüntüleme denetim günlüğüne yazılır. Admin mesaj yazamaz.
- E-posta **sıra değişiminde** gider: karşı taraf yanıt verene kadar gelen ardışık mesajlar tek
  e-posta üretir.
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

## 5. Mesaj metni — üç yazma yolunda tek kapı

`prepareQuestionMessageBody` (`api/services/product-question.service.ts`) soru, müşteri yanıtı ve satıcı
yanıtı için **aynı** kontrolü uygular: `trim()` → 2–2000 karakter → `assertNoContactSharing`. Saklanan
metin her zaman bu fonksiyonun çıktısıdır; böylece ilk soruda engellenen bilgi yanıtta paylaşılamaz.
Route katmanındaki zod yalnız kaba bir üst sınırdır (4000).

---

## 6. Eşzamanlılık

- **Konuşma açma:** `create` benzersiz anahtara takılırsa (`P2002`) istek **yeni bir transaction**da
  kazanan konuşmaya mesaj ekler; ikinci "yeni soru" e-postası üretmez.
- **Mesaj sırası (kilit altında):** `appendProductQuestionMessage` ilk iş olarak konuşmanın
  `messageSeq` sayacını artırır; bu güncelleme satır kilidini alır. Mesajın `seq`'i, zaman damgası,
  bildirim kararını veren durum okuması ve "son mesaj" alanları bu kilit altında yazılır. Paralel
  yazıcılar kilit sırasına göre seri hâle gelir: sıra numaraları commit sırasını izler, sonraki yazıcı
  öncekinin durumunu görür (tur başına tek e-posta) ve hiçbir yazma bir sınırı geriye taşıyamaz.
  `lastMessageAt` yalnız gösterim içindir ve kayıtlı değerin gerisine düşmez (sunucular arası saat farkı).
- **Olay anahtarı:** `product-question:{threadId}:{seller|customer}:turn:{turnSeq}` — mesaj kimliğine
  değil sıraya bağlı; kilide ek ikinci savunma hattı.
- Bildirim atlanacaksa outbox satırı **hiç yazılmaz** (worker `emailTo` yokken `user.email`'e düştüğü
  için yalnız `emailTo`'yu atlamak e-postayı durdurmaz).

Gerçek PostgreSQL testleriyle doğrulandı. Mutasyon kontrolü: bildirim kararı kilitten önce okunan
duruma dayandırılınca iki paralel test düştü, geri alınınca geçti. (İlk sürümdeki koşullu `updateMany`
claim'i de aynı testlerde doğrulanmıştı; inceleme sonrası kilit-önce sıra modeline geçildi.)

---

## 7. Okundu bilgisi

- Okunmamış ve okundu sınırları **mesaj sıra numarasıdır**, saat değil: okunmamış = karşı tarafın son
  mesaj `seq`'i > kendi okundu `seq`'i. Kilit sayesinde görünür mesajlar her zaman bir önektir; geç
  görünür olan mesaj daima daha büyük `seq` alır ve okundu sınırının gerisinde kalamaz.
- Sunucu render'ı ve bağlantı prefetch'i okundu **yazmaz**.
- Konuşma ekranı yerleşip sekme görünürken istemci, **ekranda gösterilen son mesajın** kimliğiyle
  `POST …/read` gönderir (müşteri: `/api/product-questions/:id/read`, satıcı:
  `/api/seller/product-questions/:id/read`).
- Sunucu mesajın o konuşmaya, konuşmanın da görüntüleyene ait olduğunu tek sorguda doğrular (aksi 404),
  sınırı mesajın `seq`'ine taşır ve **geri götürmez** (`xLastReadSeq < seq` koşulu).
- Mesaj göndermek okundu sınırını değiştirmez. Admin görüntülemesi okundu yazmaz.
- Satıcı menüsündeki rozet aynı kuralla sayılır.
- **Yeniden deneme:** okundu isteği ortak `startReadReceipt` (`packages/ui/src/lib/read-receipt.ts`)
  ile gönderilir. Başarılı istek bir daha gönderilmez; yalnız geçici hatalar (ağ hatası, 429, 5xx)
  toplam 3 denemeye kadar, artan gecikmeyle (1 sn, 3 sn; 429'da `Retry-After`, en çok 30 sn) yeniden
  denenir; 400/401/403/404/422 denenmez. Sayfa gizliyken gönderilmez, görünür olunca devam eder;
  bileşen kapanınca bekleyen deneme iptal edilir.
- `advanced: false` hata değildir: aynı veya daha eski bir mesaj zaten okunmuşsa beklenen sonuçtur.

---

## 8. Olay kataloğu

| Olay | Tip | Alıcı | Konu | eventKey | Bağlantı |
|---|---|---|---|---|---|
| Müşteri yeni konuşma açar veya satıcının yanıtından sonra yazar | `seller_product_question` | satıcı (`seller.user.email`) | **Müşteri Sorusu — {ürün}** | `product-question:{id}:seller:turn:{n}` | `{satıcı paneli}/musteri-sorulari/{id}` |
| Satıcı, müşteri beklerken yanıt verir | `customer_product_question_answered` | müşteri | **Sorunuz yanıtlandı — {ürün}** | `product-question:{id}:customer:turn:{n}` | `{web}/hesabim/sorularim/{id}` |

Her iki şablon: HTML + düz metin, ürün görseli (güvenli https ise), 400 karakterlik alıntı
(`escapeHtml`, satır sonları korunur), konuşma ekranına CTA ve "yanıt e-postayla değil panelden verilir"
notu. Satıcı e-postası müşterinin e-postasını içermez; ad `maskCustomerName` ile gösterilir.
Kuyruk: `noreply` → işlemsel `notification-dispatch`.

---

## 9. Ekranlar

| Yüzey | Yol | Not |
|---|---|---|
| Storefront ürün sayfası | `/urun/[slug]` | Ürünü Paylaş / Soru Sor; oturumsuz tıklama `/giris?callbackUrl=/urun/{slug}?soru=1`, dönüşte form açık |
| Storefront sipariş | `/siparis/[id]` | satır başına "Satıcıya Soru Sor" |
| Müşteri hesabı | `/hesabim/sorularim?sayfa=N`, `/hesabim/sorularim/[id]` | menüde **Sorularım**; 30'luk sayfalar |
| Satıcı paneli | `/musteri-sorulari?durum=…&sayfa=N`, `/musteri-sorulari/[id]` | "Siparişler" bölümünde, okunmamış rozeti; askıdaki satıcıda da görünür; 30'luk sayfalar, filtre sayfalar arasında korunur |
| Admin paneli | `/musteri-sorulari`, `/musteri-sorulari/[id]` | liste yalnız üst veri (mesaj içeriği yok), detay salt okunur + audit; detay bağlantısında prefetch kapalı |

Gizlilik metni (soru formu, müşteri listesi, satıcı listesi): "Konuşma herkese açık değildir. Siz,
ilgili satıcı [satıcı ekranında: müşteri] ve denetim amacıyla yetkili yöneticiler erişebilir."

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

**PostgreSQL (yeni):** `tests/postgres/product-question-concurrency.test.ts` — 8 test: eşzamanlı iki
ilk soru → 1 konuşma / 2 mesaj / 1 e-posta; eşzamanlı üç müşteri mesajı → 1 e-posta, `turnSeq` +1;
eşzamanlı satıcı yanıtları → 1 e-posta; satış öncesi ve sipariş konuşmalarının ayrılması; outbox hatasında
rollback; okundu sınırının monotonluğu ve yabancı mesaj reddi; **ters tamamlanma** (A kilidi alıp commit
etmeden bekler, B ve bir okundu isteği arkasında bekler → seq'ler 1..3 boşluksuz, B > A, `lastMessageAt`
geri gitmez, arada yapılan okuma yeni mesajları okunmamış bırakır); **101 konuşma** (30'luk 4 sayfa, en
eski konuşma son sayfada, aralık dışı sayfa son sayfaya çekilir).

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
