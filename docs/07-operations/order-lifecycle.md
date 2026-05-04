# Son güncelleme: 2026-04-18
# Durum: taslak v1

# Order Lifecycle — Sipariş Yaşam Döngüsü

Kaynak kurallar: `.claude/rules/08-order-lifecycle-rules.md`, `.claude/rules/07-marketplace-finance-rules.md`, `CLAUDE.md §2`

---

## 1. Temel İlke

Hanuja merkezi tahsilat modeliyle çalışır. Müşteri Hanuja'ya öder; satıcı yalnızca ödeme onaylı siparişleri görür; ödeme yalnızca `delivery_confirmed` sonrasında başlar.

Sipariş akışı aşağıdaki ayrımlara kesinlikle uymalıdır:

- `delivered` ≠ `delivery_confirmed` (payout countdown yalnızca `delivery_confirmed` ile başlar)
- Ödenmemiş sipariş satıcıya asla görünmez
- Kargoya verilen sipariş için basit iptal yolu kapanır; iade/uyuşmazlık akışına geçilir
- İptal nedenleri birbirine karıştırılmaz — her nedenin ayrı status değeri vardır

---

## 2. Üst Düzey Sipariş Akışı

```
Müşteri sepet → Ödeme girişimi → Ödeme onayı
    → Satıcı kuyruğu → Satıcı kabulü → Hazırlık
    → Kargoya verildi → Teslim edildi → Teslim onaylandı
    → Payout hold (30 gün) → Ödeme hazır → Ödeme yapıldı
```

Her adım bir `OrderStatusHistory` kaydıyla belgelenir.

---

## 3. Status Aileleri

### A. Oluşturma ve Ödeme

| Status | Açıklama |
|--------|----------|
| `draft` | Sepet henüz siparişe dönüşmemiş |
| `checkout_started` | Ödeme sayfasına girildi |
| `payment_pending` | Ödeme girişimi yapıldı, onay bekleniyor |
| `bank_transfer_waiting` | Havale/EFT yatırıldı, admin onayı bekleniyor |
| `bank_transfer_confirmed` | Havale/EFT admin tarafından onaylandı |
| `payment_confirmed` | Ödeme kesinleşti — satıcı akışı başlar |
| `payment_failed` | Ödeme başarısız |
| `payment_cancelled` | Ödeme iptal edildi |

Satıcıya yalnızca `payment_confirmed` ve `bank_transfer_confirmed` durumlarındaki siparişler iletilir. `payment_pending`, `bank_transfer_waiting`, `payment_failed` durumundaki siparişler satıcı panelinde görünmez.

### B. Satıcı Akışı

| Status | Açıklama |
|--------|----------|
| `seller_queue_ready` | Satıcı kuyruğuna düştü, aksiyon bekleniyor |
| `seller_reviewing` | Satıcı siparişi inceliyor |
| `seller_accepted` | Satıcı onayladı, hazırlık başlar |
| `seller_rejected` | Satıcı reddetti — ceza değerlendirmesi açılır |
| `preparing` | Ürün hazırlanıyor |
| `awaiting_shipment` | Kargoya teslim bekleniyor |

### C. Kargo ve Teslimat

| Status | Açıklama |
|--------|----------|
| `shipped` | Kargoya verildi, takip numarası girildi |
| `delivered` | Kargo firması teslim sinyali verdi veya admin doğruladı |
| `delivery_confirmation_pending` | Müşteri onayı bekleniyor (72 saat sessiz onay penceresi) |
| `delivery_confirmed` | Teslim operasyonel olarak kabul edildi — payout countdown başlar |

### D. İptal Durumları

| Status | Neden |
|--------|-------|
| `cancelled_by_customer` | Müşteri kargoya verilmeden önce iptal etti |
| `cancelled_by_admin` | Admin müdahalesiyle iptal |
| `cancelled_due_to_payment_failure` | Ödeme doğrulanamadı |
| `cancelled_due_to_seller_rejection` | Satıcı reddetti, müşteriye iade başladı |
| `cancelled_due_to_20day_breach` | 20 günlük teslimat yükümlülüğü ihlali |

Her iptal nedeni ayrı bir status değeri taşır. Tek bir `cancelled` durumu kullanılmaz.

### E. İade ve Uyuşmazlık

| Status | Açıklama |
|--------|----------|
| `return_requested` | Müşteri iade talebi açtı |
| `return_under_review` | Admin/satıcı inceliyor |
| `return_approved` | İade onaylandı |
| `return_rejected` | İade reddedildi |
| `return_in_transit` | Müşteri ürünü kargoya verdi |
| `return_received` | Ürün alındı |
| `refund_pending` | İade ödemesi işlemde |
| `refund_completed` | İade tamamlandı |
| `dispute_open` | Uyuşmazlık açıldı |
| `dispute_resolved` | Uyuşmazlık çözüldü |

### F. Payout Bağlantılı Durumlar

Bu durumlar birincil `Order` sütununda değil, `Payout` modelinde tutulur. Ancak lifecycle görünürlüğü için order ile ilişkilendirilir.

| Status | Açıklama |
|--------|----------|
| `payout_hold_active` | 30 günlük bekleme dönemi devam ediyor |
| `payout_blocked` | İade/uyuşmazlık/fraud/admin nedeniyle bloke |
| `payout_ready` | Tüm kontroller geçti, ödeme yapılabilir |
| `payout_paid` | Satıcıya ödeme gerçekleşti |

---

## 4. Kritik Ayrım: `delivered` ve `delivery_confirmed`

### `delivered`
Kargo fiziksel olarak müşteriye ulaştığı sinyali — kargo firması entegrasyonu, takip sayfası veya admin doğrulamasından gelir.

### `delivery_confirmed`
Payout sayacı için operasyonel kabul. Aşağıdaki yollardan biriyle oluşur:

1. Müşteri "Teslim Aldım" butonuna basar
2. Admin manuel olarak teslim onaylar
3. `delivered` durumuna geçildikten 72 saat içinde müşteri itiraz açmazsa sistem otomatik olarak `delivery_confirmed`'e geçirir (sessiz onay)

Sessiz onay bir BullMQ job tarafından tetiklenir; zaman damgası `order.deliveryConfirmedAt` alanına yazılır. Desteksiz yorum ya da notla payout zamanlaması belirlenmez.

---

## 5. Satıcı Reddi Akışı

Satıcı reddi istisnai ve denetimli bir süreçtir.

### Adımlar
1. Satıcı panelde reddetme seçer ve zorunlu gerekçe girer
2. Sistem status'u `seller_rejected` yapar, `OrderStatusHistory` kaydı oluşturur
3. Admin panelde red görünür, bildirim gider
4. Müşteriye iade/bildirim akışı başlar
5. Ceza değerlendirmesi açılır: ürün fiyatının %20'si `Penalty` kaydına yazılır
6. `SellerLedgerEntry` (type: `penalty`) eklenir, bakiye güncellenir
7. Sipariş `cancelled_due_to_seller_rejection` durumuna geçer

### Geçerli Red Gerekçeleri
- Stok hatası
- Fiyat hatası
- Üretim imkansızlığı
- Kalite sorunu
- Teknik sorun
- Mücbir sebep

### İstisna — Ceza Muafiyeti
Admin aşağıdaki durumlarda cezayı `waived` olarak işaretleyebilir:
- Platform/sistem kaynaklı hata
- Doğal afet veya mücbir sebep
- Yanlış ürün/platform eşlemesi

Muafiyet silinmez — `Penalty.status = waived`, `waivedBy`, `waivedAt`, `waiverReason` alanları doldurulur ve `AdminAuditLog`'a yazılır.

---

## 6. 20 Günlük Teslimat Yükümlülüğü

### Kural
Ürün müşteriye 20 gün içinde teslim edilmelidir. Bu süre bir BullMQ zamanlayıcısıyla izlenir.

### İhlal Sonucu
20. gün dolduğunda ve sipariş hâlâ `shipped` veya daha önceki bir aşamada ise:

1. Müşteri iptal hakkı kazanır veya admin iptal edebilir
2. Sipariş `cancelled_due_to_20day_breach` durumuna geçer
3. Satıcı ceza değerlendirmesi açılır: ürün fiyatının %20'si
4. Müşteri iade/iptal finans akışı başlar
5. Satıcı payout eligibility o sipariş için bloke edilir

### Kontrollü Uzatma
Admin 10 günlük uzatma kararı verebilir — yalnızca müşteri bilgilendirilmişse ve `AdminAuditLog` kaydıyla. Sessiz uzatma kabul edilmez.

---

## 7. İptal Kategorileri

Tüm iptaller ayrı nedenlerle kaydedilir. Aynı `cancelled` değeri altında birleştirilmez.

| Kategori | Tetikleyici | Ceza? |
|----------|-------------|-------|
| Ödeme başarısız | Iyzico/EFT doğrulama | Hayır |
| Müşteri önceden iptal | Kargo öncesi müşteri isteği | Hayır |
| Satıcı reddi | Satıcı reddetme aksiyonu | Evet (%20) |
| Admin iptali | Admin müdahalesi | Duruma göre |
| 20 gün ihlali | Zamanlayıcı/admin | Evet (%20) |
| Fraud/risk | Risk motoru veya admin | Duruma göre |

---

## 8. Kargo Sonrası Akış

Sipariş `shipped` durumuna geçtikten sonra basit iptal akışı kapanır.

- Müşteri artık sipariş iptali değil, iade talebi açabilir
- Admin iade veya uyuşmazlık akışı başlatabilir
- Fraud/risk durumunda admin yine müdahale edebilir, ancak bu da `AdminAuditLog`'a yazılır

---

## 9. İade Akışı

### 14 Günlük Cayma Hakkı (Hızlı Yol)
`delivery_confirmed` tarihinden itibaren 14 gün içinde açılan iade talepleri standart hızlı yoldan işlenir:

1. Müşteri sebep girer, talep `return_requested`
2. `isWithinWindow = true` olarak kaydedilir
3. Admin veya sistem onaylar (`return_approved`)
4. Müşteri ürünü kargoya verir (`return_in_transit`)
5. Ürün alınır (`return_received`)
6. İade ödeme işlenir (`refund_pending` → `refund_completed`)

### 14 Gün Sonrası
`isWithinWindow = false`; admin değerlendirmesi zorunludur. Otomatik onay yapılmaz.

---

## 10. Uyuşmazlık Akışı

Uyuşmazlık iade ile aynı şey değildir.

Açılabilecek durumlar: hasarlı ürün, eksik ürün, yanlış ürün, teslimat anlaşmazlığı, fraud şüphesi.

Uyuşmazlık açıkken:
- Satıcı payoutu bloke kalır
- Admin görünürlüğü yüksektir
- Mesajlar ve kanıtlar `DisputeMessage` / `MediaAsset` tablolarına kaydedilir
- Çözüm admin kararıyla (`dispute_resolved`) kapatılır
- Payout ancak çözüm sonrasında serbest bırakılabilir

---

## 11. Admin Override Noktaları

Admin aşağıdaki noktalarda müdahale yetkisine sahiptir:

| Aksiyon | AdminActionType |
|---------|----------------|
| Ödeme manuel onaylama | `payment_approved` |
| Havale/EFT onay veya red | `bank_transfer_approved`, `bank_transfer_rejected` |
| Sipariş iptali | `order_cancelled` |
| Ceza muafiyeti | `penalty_waived` |
| Teslim onayı (manuel) | `delivery_confirmed_manual` |
| 20 gün uzatma | `fulfillment_window_extended` |
| Uyuşmazlık açma/çözme | `dispute_opened`, `dispute_resolved` |
| Payout bloke/serbest | `payout_blocked`, `payout_hold_released` |

Her admin aksiyonu `AdminAuditLog`'a aktör ID, zaman damgası, önceki durum, yeni durum ve gerekçe ile yazılır.

---

## 12. Bildirim Tetikleyicileri

Aşağıdaki geçişler bildirim oluşturur:

- `payment_confirmed` → müşteri + satıcı
- `seller_queue_ready` → satıcı
- `seller_accepted` / `seller_rejected` → müşteri
- `shipped` → müşteri
- `delivered` → müşteri
- `delivery_confirmed` → satıcı (payout hold başladı)
- İptal → müşteri + satıcı
- `return_requested` → satıcı + admin
- `return_approved` / `return_rejected` → müşteri
- `refund_completed` → müşteri
- `dispute_open` → admin + satıcı
- `dispute_resolved` → müşteri + satıcı

---

## 13. Veri Modeli Gereksinimleri

- `Order.status`: `OrderStatus` enum — Prisma şemasında tanımlı
- `Order.deliveryConfirmedAt`: payout sayacının başlangıç noktası
- `OrderStatusHistory`: append-only, üzerine yazma yok
- Her geçiş için `fromStatus`, `toStatus`, `actorId`, `actorRole`, `reason`, `createdAt` kaydedilir
- `Payout` modeli sipariş yaşam döngüsüyle ayrı tutulur; finance state burada yönetilir

---

## 14. Çapraz Referanslar

- `.claude/rules/08-order-lifecycle-rules.md` — kaynak kural
- `.claude/rules/07-marketplace-finance-rules.md` — payout ve ceza kuralları
- `docs/07-operations/payout-lifecycle.md` — payout hold ve release detayları
- `docs/06-engineering/event-status-model.md` — status geçiş matrisi
- `docs/01-business/penalty-policy.md` — ceza politikası
- `docs/01-business/refund-return-policy.md` — iade politikası
