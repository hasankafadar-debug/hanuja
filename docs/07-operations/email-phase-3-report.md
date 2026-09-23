# E-posta Faz 3 — Admin operasyon e-postaları

**Tarih:** 22–23 Eylül 2026
**Kapsam:** yedi operasyon olayının yapılandırılabilir bir operasyon posta kutusuna e-posta
göndermesi. Faz 1 (kalıcı gönderim altyapısı) ve Faz 2 (müşteri/satıcı sipariş e-postaları)
üzerine kurulur.

---

## 1. Neden

Faz 3 öncesinde admin panelinde **hiçbir olay e-posta üretmiyordu**. Yedi operasyon olayının tamamı
ya yalnız uygulama içi bildirim yazıyordu ya da hiç sinyal üretmiyordu; yani bir EFT ödemesi, bir
uyuşmazlık ya da yeni bir satıcı başvurusu, biri panele bakana kadar görülmüyordu.

Faz 3 öncesi durum:

| Olay | Önceki sinyal |
|---|---|
| Adet bazlı iptal | yalnız in-app admin kopyası |
| İade talebi | v2'de in-app kopya; legacy akışta **hiç** |
| Uyuşmazlık | yalnız satıcı reddi yolunda in-app; diğer **iki kaynak sessiz** |
| Destek bileti | satıcı bileti commit sonrası (kalıcı değil); müşteri bileti **hiç** |
| EFT onayı | **hiç** |
| Sevk riski | `admin_fulfillment_risk` tipi hiç kullanılmıyordu |
| Yeni satıcı başvurusu | **hiç** |

---

## 2. Alıcı modeli

- Yedi olay slug'ı için ayrı alıcı adresi: `admin_notification_recipients` tablosu
  (`event` birincil anahtar). Migration yedi satırı `admin@hanuja.com.tr` ile ekler.
- Satır bulunamazsa `PLATFORM_LEGAL_INFO.supportEmail` fallback'i kullanılır — bildirim sessizce
  düşmez.
- Yönetim: **Ayarlar → Bildirim Alıcıları** (`/ayarlar`), `PUT /api/admin/notification-recipients`.
  CSRF + admin rol kontrolü route'ta, e-posta doğrulaması hem route'ta (zod) hem serviste yapılır.
  Her değişiklik `AdminAuditLog`'a `notification_recipient_changed` olarak yazılır (eski/yeni adres).
- **Alıcı kayıt anında çözülür.** Ayar değiştirildikten sonra oluşan olaylar yeni adrese gider;
  ayar değişmeden önce kuyruğa girmiş kayıtlar eski adrese gider. (PostgreSQL testiyle doğrulandı.)

### Uygulama içi bildirimler değişmedi

Adminlerin kendi in-app bildirimleri aynen korunur ve **çoğaltılmaz**. Bu fazda in-app bildirimi
olmayan olaylara yeni in-app bildirimi **eklenmedi**. Alıcı ayarı in-app alıcı kümesini etkilemez.

---

## 3. "Ops alıcısı" — kullanıcı hesabı olmayan gönderim

Operasyon posta kutusunun kullanıcı hesabı yoktur ve sahte admin hesabı oluşturulmaz. Gönderim
mevcut kalıcı altyapıyı kullanır; ayrı, takipsiz bir SMTP yolu yoktur.

| Katman | Çözüm |
|---|---|
| `NotificationOutbox.userId` | Ayrılmış sabit `OPS_RECIPIENT_ID = 'ops'`. Kolonun FK'si yok. Tekilleştirme `(userId, type, eventKey)` unique index'i üzerinden **aynen** çalışır. Kolonu nullable yapmak tekilleştirmeyi bozardı (PostgreSQL NULL'ları farklı sayar). |
| `NotificationDelivery.userId` | **Nullable** yapıldı (migration). Ops gönderiminde `null`; tekilleştirme `(recipient, channel, eventKey)` ile sağlanır. |
| In-app `Notification` | Ops satırı için **oluşturulmaz**. |

### İzin listesi — ops yolu sınırlıdır

`userId === 'ops'` olması tek başına rol/kullanıcı kontrolünü atlama yetkisi **vermez**. Yalnız
`ADMIN_OPERATION_TYPES` içindeki sekiz tip ve yalnız `role: 'admin'` politikalı tipler bu yoldan
geçer; başka bir tip `EMAIL_OPS_TYPE_NOT_ALLOWED` ile **başarısız** işaretlenir (sessizce atlanmaz)
ve admin `/e-posta` ekranında görünür. Kural hem üretim tarafında
(`recordAdminOperationNotification`) hem tüketim tarafında (dispatch job) zorlanır.

Bir operasyon tipinin **kullanıcıya bağlı** kopyası (adminin in-app satırı) e-posta bacağı açmaz;
böylece admin sayısı gönderilen e-posta sayısını değiştirmez.

### Nullable `userId` — gönderim yaşam döngüsünde bulunan hata

Kod okumasıyla doğrulandı, varsayılmadı:

| Nokta | Sonuç |
|---|---|
| `/e-posta` listesi | `where` yalnız `status` ile filtreliyor → ops satırları görünür. Değişiklik gerekmedi. |
| Yeniden deneme payload round-trip | Payload `userId: 'ops'` + `emailTo` taşıdığı için aynı ops satırı yeniden üretilir. |
| **Belirsizlik guard'ı** (`notification-operations.service`) | **Kırıktı.** `count({ eventKey, userId: outbox.userId, transportStatus: 'uncertain' })` ops satırında `userId = null` olduğu için asla eşleşmez; "SMTP sonucu belirsiz" koruması sessizce devre dışı kalırdı. Ops satırında eşleşme artık `recipient` üzerinden yapılıyor. |
| Resend webhook eşlemesi | `providerMessageId`/`messageId` üzerinden çalışıyor, `userId` kullanmıyor. |

Dördü de PostgreSQL testiyle doğrulandı.

---

## 4. Olay kataloğu (7 olay, 8 tip, 11 tetikleyici yolu)

| # | Olay | Tetikleyici | Tip | eventKey | Bağlantı |
|---|---|---|---|---|---|
| 1 | Adet bazlı iptal | `quantity-cancellation.service` | `admin_order_cancellation` | `cancellation:{id}:ops` | `/siparisler/{orderId}` |
| 2a | İade (v2) | `quantity-return.openRequest` | `admin_return_requested` | `return:{id}:ops` | `/iadeler` |
| 2b | İade (legacy) | `return.service.openRequest` | `admin_return_requested` | `return:{id}:ops` | `/iadeler` |
| 3a | Uyuşmazlık | `dispute.service.openDispute` | `admin_dispute_opened` | `dispute:{id}:ops` | `/uyusmazliklar/{id}` |
| 3b | Uyuşmazlık | `return.service.rejectReceiptBySeller` | `admin_dispute_opened` | `dispute:{id}:ops` | `/uyusmazliklar/{id}` |
| 3c | Uyuşmazlık | `quantity-return.decideReceipt` (kısmi red) | `admin_dispute_opened` | `dispute:{id}:ops` | `/uyusmazliklar/{id}` |
| 4a | Destek (satıcı) | `support-ticket.createForSeller` | `admin_support_new_ticket` | `support:{id}:ops` | `/destek/{id}` |
| 4b | Destek (müşteri) | `customer-support-ticket.createForCustomer` | `admin_customer_support_new` | `support:{id}:ops` | `/musteri-destek/{id}` |
| 5 | EFT onayı | `checkout.service` EFT dalı | `admin_bank_transfer_pending` | `order:{id}:eft-pending` | `/odemeler` |
| 6 | Sevk riski | `fulfillment-risk` job sweep | `admin_fulfillment_risk` | `fulfillment-risk:{orderId}:{sellerId}:{seq}:{status}` | `/siparisler/{orderId}` |
| 7 | Satıcı başvurusu | seller-panel onboarding route | `admin_seller_application` | `seller:{id}:application:{seq}` | `/saticilar/{id}` |

Destek bileti **tek yapılandırılabilir olaydır** ama iki tip ve iki ayrı derin bağlantı taşır;
şablon eşlemesi bu yüzden yedi değil **sekiz** case içerir.

Tetikleyicilerin tamamı ilgili iş transaction'ı içinde yazılır; hata yutulmaz, iş geri alınırsa
bildirim de geri alınır. `support-ticket.service`'in commit sonrası `notifications.send` çağrısı
`recordNotification(tx, …)` ile değiştirildi — satıcı bileti in-app bildirimi de artık kalıcı.

---

## 5. Sevk riski — kalıcı geçiş kaydı

Yeni `fulfillment_risk_notification_states` tablosu (sipariş + satıcı başına tek satır;
`notifiedStatus`, `transitionSeq`, `version`).

**Tarama kümesi iki kaynağın birleşimidir:** (a) `status ∈ {warning, breached}` olan aktif riskler,
(b) `notifiedStatus ≠ resolved` olan **tüm** durum kayıtları. (b) olmadan aktif listeden çıkan bir
grup eski seviyesinde donar ve risk daha sonra aynı seviyede yeniden oluştuğunda e-posta kaçardı.

Geçiş kuralı:

| Durum | Sonuç |
|---|---|
| Kayıt yok + seviye warning/breached | `seq = 1`, e-posta |
| Kayıt var + seviye değişti (warning ↔ breached) | `seq += 1`, e-posta |
| Kayıt var + seviye `resolved` | yalnız durum güncellenir, **e-posta yok** |
| Seviye aynı | hiçbir şey (job her gün çalışır; gecikme günü artışı e-posta üretmez) |

`eventKey` `seq` içerdiği için giderilip yeniden oluşan risk **yeni** e-posta alır.

**Eşzamanlılık:** önce sürüm kontrollü güncelleme (`updateMany({ id, version })`), yalnız `count === 1`
ise outbox yazılır — kaybeden koşu hiçbir şey yazmaz. `create` yarışında P2002 alınırsa grup **yeni
bir transaction'da** (en fazla üç deneme) yeniden işlenir ve her denemede risk durumu ile state
satırı yeniden okunur. İki paralel sweep PostgreSQL testinde tek satır / tek geçiş üretiyor.

E-posta içeriği: risk seviyesi, satıcı, geciken ürün/adet listesi, sevk taahhüdü tarihi, gecikme
günü ve sipariş bağlantısı. **Günlük özet bu fazın kapsamında değildir.**

---

## 6. Satıcı başvurusunda yeniden gönderim

`Seller` satırı kullanıcı başına bir kez oluşuyor ve şemada başvuru kimliği yoktu; sabit bir anahtar
satıcının ömrü boyunca tek bildirim üretirdi. `Seller.applicationSubmissionSeq` eklendi ve olay
anahtarı `seller:{id}:application:{seq}` oldu.

**Her `pending` geçişi yeni başvuru değildir.** Sayaç yalnız satıcının kendi eylemiyle yaptığı
gerçek incelemeye gönderimde artar:

| Olay | Sayaç | E-posta |
|---|---|---|
| İlk başvuru (onboarding POST) | 1 | evet |
| Satıcının reddedilen başvuruyu yeniden göndermesi | +1 | evet |
| Admin'in kaydı yeniden incelemeye alması | değişmez | hayır |
| Belge yükleme / profil güncelleme | değişmez | hayır |
| Aynı isteğin tekrarı | değişmez | hayır |

**Bugünkü gerçek durum:** kod taraması, `Seller.status`'u `pending`'e geri döndüren **hiçbir yol
olmadığını** gösterdi (`seller.service` yalnız `active`/`suspended` yazıyor; `seller-document.service`
içindeki `pending` değerleri belge durumudur, satıcı durumu değil). Yani satıcı yeniden gönderim
yolu bugün **yoktur**; kolon varsayılan `1` ile kalır ve anahtar böyle bir yol eklendiğinde ileriye
dönük hazırdır. Böyle bir yol eklenirse sayacı artırmak ve aynı transaction'da bildirim yazmak
o işin parçasıdır.

---

## 7. Bilinen sınırlar / açık takip işleri

- `seller.service.submitOnboarding` bir **ölü yol**dur (hiçbir çağıranı yok) ve satıcı kaydı
  oluşturduğu hâlde operasyon bildirimi yazmaz. Canlı yol yalnızca seller-panel onboarding
  route'udur. Bu servis canlıya alınırsa bildirimin de eklenmesi gerekir.
- Kart `pending` iadeleri için admin tetikleyici route yokluğu (Faz 2'den devreden açık iş) bu
  fazda değişmedi.
- Admin `/e-posta` ekranı ops satırlarını listeler ama "kime gitti" filtresi yoktur.
- Sevk riski e-postası günlük özet içermez; her seviye değişimi ayrı e-postadır.

---

## 8. Test kapsamı

**Birim (yeni):**
- `tests/unit/services/admin-notification.service.test.ts` (7) — alıcı çözümü, fallback, ops
  satırının yazımı, izin listesi dışı tipin reddi, hata yutulmaması, olay/tip sayımı.
- `tests/unit/jobs/fulfillment-risk-notification.test.ts` (9) — seviye toplama, ilk risk,
  seviye değişimi, aynı seviye tekrarı, resolved, aktif listeden düşen grup, yeniden oluşma,
  sürüm çakışması, P2002 sonrası yeni transaction.
- `tests/unit/email-templates-admin-operations.test.ts` (8) — sekiz şablon, derin bağlantılar,
  HTML kaçışı.
- `tests/security/notification-recipients-route.test.ts` (7) — CSRF, rol, kimlik doğrulama,
  geçersiz e-posta, bilinmeyen olay, aktör aktarımı.

**Birim (güncellenen):**
- `tests/unit/jobs/notification-dispatch.job.test.ts` — ops satırı (in-app yok, `userId: null`),
  izin listesi dışı tipin gözlemlenebilir başarısızlığı, admin kullanıcı kopyasının in-app kalması.
  "Desteklenmeyen şablon" fixture'ı `admin_support_new_ticket`'tan `account_verified`'a taşındı
  (ilki artık şablon kazandı).
- `tests/unit/api/seller-onboarding-email-otp.test.ts` — başvuru ops satırı, `submissionSeq` anahtarı.
- `quantity-cancellation` / `quantity-return` bildirim testleri — ops satırı beklentisi.

**PostgreSQL** (`tests/postgres/admin-operation-notifications.test.ts`): 11 tetikleyici yolunun
her biri ayrı ayrı; tekilleştirme; üç admin varken tek e-posta; alıcı ayarı değişimi (yeni olay yeni
adrese, kuyruktaki kayıt eski adrese) + audit kaydı; iş transaction'ı geri alınınca ops satırının da
geri alınması; iki paralel sweep; nullable `userId` gönderim yaşam döngüsü (liste, yeniden deneme,
belirsizlik guard'ı regresyonu, webhook).

---

## 9. Deploy

- **Migration var:** `20260922120000_admin_operation_emails` — üç `NotificationType` değeri, bir
  `AdminActionType` değeri, `notification_deliveries.userId` nullable,
  `sellers.applicationSubmissionSeq`, `admin_notification_recipients` (+7 varsayılan satır),
  `fulfillment_risk_notification_states`.
- **Yeni env yok.**
- Sıra: `pnpm db:migrate:deploy` → **worker → admin-panel → seller-panel → web**. Worker önce
  olmalı: üç yeni `NotificationType` değerini eski worker `EMAIL_TEMPLATE_UNSUPPORTED` ile düşürür.
- Deploy sonrası **Ayarlar → Bildirim Alıcıları** ekranından adresler gözden geçirilmelidir.
