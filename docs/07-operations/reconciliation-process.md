# Son güncelleme: 2026-04-18
# Durum: taslak v1

# Reconciliation Process — Mutabakat Süreci

Kaynak kurallar: `.claude/rules/07-marketplace-finance-rules.md`, `CLAUDE.md §2.1, §2.3`, `db/schema/schema.prisma`

---

## 1. Temel İlke

Hanuja merkezi tahsilat modeliyle çalıştığından sipariş kayıtları, ödeme kayıtları, payout kayıtları ve satıcı ledger kayıtları birbiriyle tutarlı olmak zorundadır. Tutarsızlık nakit kaybı, yanlış payout veya doğrulanamaz finans geçmişi anlamına gelir.

Mutabakat süreci şu soruyu yanıtlar: "Tahsil edilen para, satıcı ledger'ı ve payout kayıtları birbirini tutarlı biçimde açıklıyor mu?"

Hiçbir payout mantığı mutabakat yapılamayacak şekilde inşa edilmez.

---

## 2. Mutabakatın Kapsadığı Kayıt Setleri

Mutabakat şu tablolar arasındaki ilişkiyi doğrular:

| Tablo | Rolü |
|-------|------|
| `orders` | Sipariş durumu, tutar alanları, zaman damgaları |
| `payments` | Tahsil edilen tutar, yöntem, onay durumu |
| `payment_events` | Webhook geçmişi, çift işlem koruması |
| `order_lines` | Satıcı bazında brüt tutar, komisyon, net |
| `payouts` | Satıcı payout hesabı, kesinti ayrımı, status |
| `payout_batches` | Toplu ödeme referansı, toplam tutar |
| `seller_ledger_entries` | Her finansal hareketin immutable kaydı |
| `penalties` | Ceza tutarı, uygulama ve muafiyet durumu |
| `return_requests` | İade tutarı, kesinleşme tarihi |
| `disputes` | Payout bloke durumu, çözüm sonucu |
| `admin_audit_logs` | Manuel müdahale izleri |

---

## 3. İmmutable Ledger Tasarımı

`SellerLedgerEntry` tablosu append-only'dir. Kural:

- Hiçbir kayıt güncellenmez
- Hiçbir kayıt silinmez
- Hata düzeltmesi yeni bir karşıt kayıtla yapılır (ters işlem)
- Her kayıt `balanceAfter` alanını taşır; bu değer önceki kaydın `balanceAfter` değerinin üzerine işlemin eklenmesiyle hesaplanır

### Ledger Bütünlük Koşulu

Herhangi bir satıcı için şu denklem sağlanmalıdır:

```
son_ledger_kaydı.balanceAfter
  = SUM(amount) tüm SellerLedgerEntry kayıtları (sellerId = X)
```

Bu denklem bir mutabakat job'ı tarafından periyodik olarak doğrulanır. Sapma varsa uyarı üretilir.

---

## 4. Tutarlılık Kontrol Noktaları

### 4.1 Ödeme — Sipariş Tutarlılığı

Her `payment_confirmed` ödeme için:

- `payment.amount` değeri `order.totalAmount` ile eşleşmeli
- `payment.orderId` aktif bir siparişe bağlı olmalı
- `payment.status = confirmed` ise `order.paymentConfirmedAt` dolu olmalı

### 4.2 OrderLine — Payout Tutarlılığı

Her `OrderLine` için:

- `unitPrice * quantity = totalPrice` doğrulanmalı
- **2026-07-09 ve sonrası siparişler:** `commissionBase = totalPrice - couponDiscountAmount`;
  `commissionAmount = roundMoney(commissionBase * commissionRate * (1 + commissionVatRate))`
  eşleşmeli; `netPayoutAmount = totalPrice - couponDiscountAmount - commissionAmount` eşleşmeli
- **2026-07-09 öncesi siparişler:** `commissionAmount = totalPrice * commissionRate` (KDV'siz);
  `netPayoutAmount = totalPrice - commissionAmount` eşleşmeli (bkz. §11 tarihi kayıt notu)
- Buna karşılık gelen bir `Payout.grossAmount` kaydı olmalı

### 4.3 Payout — Ledger Tutarlılığı

Her `payout_paid` payout için:

- `Payout.netAmount` değeri karşılık gelen `SellerLedgerEntry` (type: `payout`, negatif) ile eşleşmeli
- İlgili `sale`, `commission`, `penalty`, `refund` gibi ledger kayıtları mevcut olmalı
- Kesinti toplamı `grossAmount - netAmount` ile örtüşmeli

### 4.4 Ceza — Ledger Tutarlılığı

Her `Penalty` (status: `applied`) için:

- Karşılık gelen `SellerLedgerEntry` (type: `penalty`) bulunmalı
- `seller_rejected_paid_order` cezalarında `penaltyAmount = baseAmount * rate` doğrulanmalı
- `late_shipment_daily_accrual` cezalarında `penaltyAmount = baseAmount * dailyAccrualRate * accrualDayCount` doğrulanmalı; `lastAccrualAt` ile aynı gün için tekrar entry üretilmemiş olmalı
- 20. gecikme gününde `Order.status = cancelled_due_to_20day_breach` ve `Order.cancellationReason = auto_canceled_20day_breach` olmalı; refund akışı tetiklenmiş olmalı
- Muaf tutulan cezalarda (`status: waived`) ledger kaydı ters işlem içermeli ve `waivedBy`, `waiverReason` dolu olmalı

### 4.5b Komisyon/Ceza Faturası — Kayıt Tutarlılığı

Her `SellerInvoice` için:

- `invoiceNumber` global olarak benzersiz olmalı
- `type = commission` ise `sourceOrderId` dolu olmalı; sipariş `delivery_confirmed` durumunda olmalı
- `type = penalty` ise `sourcePenaltyId` dolu olmalı; ceza `status = applied` (waived **değil**) olmalı
- `amount > 0` olmalı; `createdByAdminId` Admin rolüne sahip kullanıcıya işaret etmeli

### 4.5 İade — Payout/Ledger Etkisi

Her kesinleşmiş `ReturnRequest` için:

- `refundAmount` değeri ilgili payout'ta `refund_amount` olarak yansımalı veya
- Payout zaten yapıldıysa `SellerLedgerEntry` (type: `refund`, negatif) eklenmiş olmalı
- `refundedAt` alanı dolu olmalı

---

## 5. Mutabakat Job Planı (BullMQ)

### 5.1 Günlük Ledger Bütünlük Taraması

**Job adı:** `reconciliation-ledger-integrity`  
**Zamanlama:** Her gün gece 02:00 (UTC+3)  
**İşlem:**
1. Tüm aktif satıcılar için `balanceAfter` tutarlılığını kontrol eder
2. Sapma varsa `AdminAuditLog`'a uyarı kaydı ekler
3. Sapma eşiği aşılırsa admin bildirim gönderilir
4. Job sonucu loglanır (başarı/hata/uyarı sayısı)

### 5.2 Payout Maturity Taraması

**Job adı:** `payout-maturity-scan`  
**Zamanlama:** Her gün (tercihen sabah 06:00)  
**İşlem:**
1. `holdUntil <= şimdiki zaman` ve `status = hold_active` olan payout'ları tarar
2. Her payout için bloke koşullarını kontrol eder (açık iade, uyuşmazlık, eksik banka bilgisi vb.)
3. Tüm koşullar temizse `status = payout_ready` yapar
4. Değişiklik varsa `SellerLedgerEntry` bekleme bitiş kaydı eklenebilir
5. İdempotent çalışır — aynı payout için çift geçiş yapılmaz

### 5.3 Ödeme — Sipariş Uyuşmazlık Taraması

**Job adı:** `reconciliation-payment-order-match`  
**Zamanlama:** Her gün  
**İşlem:**
1. `payment_confirmed` statüsündeki ödemeleri tarar
2. `payment.amount != order.totalAmount` durumlarını raporlar
3. `paymentConfirmedAt` dolu olmayan ama `payment.status = confirmed` olan siparişleri raporlar
4. Uyuşmazlık bulunursa admin panelinde "Mutabakat Uyarıları" kuyruğuna düşer

### 5.4 Payout — Provider Settlement Eşleştirmesi

**Job adı:** `reconciliation-payout-settlement`  
**Zamanlama:** Batch ödeme sonrasında tetiklenir  
**İşlem:**
1. İşlenen batch'teki her `payout_paid` kaydını doğrular
2. Banka transferi teyidini (provider yanıtı veya EFT referansı) `PayoutBatch.notes` veya harici log ile eşleştirir
3. Eşleşmeyen kayıtları `payout_blocked` olarak işaretler ve admin bildirir

---

## 6. Tutarsızlık Türleri ve Yanıtları

| Tutarsızlık Türü | Belirti | Yanıt |
|-----------------|---------|-------|
| Ledger bakiye sapması | `balanceAfter` zinciri kırık | Admin uyarısı, araştırma ve ters kayıt |
| Ödemesiz payout | Payout kaydı var, payment kaydı yok | `payout_blocked`, admin inceleme |
| Ödeme tutarı farkı | `payment.amount != order.totalAmount` | Admin inceleme, düzeltme notu |
| Cezasız ledger | Penalty `applied` ama ledger kaydı yok | Otomatik ledger kaydı oluştur veya admin uyarı |
| İadesi olup ledger etkisi olmayan | `refund_completed` ama ledger `refund` kaydı yok | Ters payout kaydı veya admin düzeltme |
| Chargeback ledger eksikliği | Chargeback ama ledger kaydı yok | Admin acil müdahale |
| Batch tutarı farkı | `PayoutBatch.totalAmount != SUM(payout.netAmount)` | Batch işlenmez, admin inceleme |

---

## 7. Finans Denetim İzi Gereksinimleri

Her önemli finans hareketi için şu bilgiler sistemde mevcut olmalıdır:

- Hangi varlığı etkiliyor? (`referenceType`, `referenceId`)
- Kim tetikledi? (`actorId` veya sistem job adı)
- Ne zaman gerçekleşti? (`createdAt`)
- Tutar neydi? (`amount`)
- İşlem öncesi bakiye neydi? (önceki kaydın `balanceAfter`)
- İşlem sonrası bakiye ne oldu? (`balanceAfter`)
- İnsan okunabilir açıklama mevcut mu? (`description`)

Bu gereksinimleri karşılamayan bir finans hareketi kabul edilmez.

### Admin Manuel Düzeltme Kuralları

Admin manuel ledger düzeltmesi yapabilir. Zorunlu alanlar:

- `type = manual_adjustment`
- `createdBy = admin user ID`
- `description` alanı doldurulmuş (gerekçe)
- `AdminAuditLog` kaydı: `actionType = manual_ledger_adjustment`, `reason` dolu

"Neden bu tutar değişti?" sorusu ledger'dan yanıtlanabilmelidir.

---

## 8. Mutabakat Raporlama

Admin panelinde mutabakat görünümleri şunları kapsamalıdır:

- Günlük ledger bütünlük durumu (sapma var/yok)
- Ödeme — sipariş uyuşmazlıkları listesi
- Payout batch eşleşme durumu
- Açık mutabakat uyarıları (resolve edilmemiş)
- Satıcı bazında ledger özeti (brüt, kesintiler, net, bakiye)
- Dönem bazında platform gelir özeti (komisyon toplamı vb.)

Her uyarının bir "çözüme bağlandı" durumu olmalıdır; uyarılar sessizce kaybolmaz.

---

## 9. Provider Settlement Eşleştirmesi

Iyzico ve EFT ödemeleri farklı eşleştirme mekanizması gerektirir.

### Kart Ödemeleri (Iyzico)
- `Payment.providerPaymentId` Iyzico conversation ID
- `Payment.providerData` ham Iyzico yanıtı (audit amaçlı)
- `PaymentEvent` tablosu her webhook'u kaydeder
- Çift webhook: idempotency anahtarı `providerPaymentId` üzerinden kontrol edilir

### Havale/EFT
- Admin `eftConfirmedBy`, `eftConfirmedAt` alanlarını doldurur
- `eftSenderName` gönderici adı doğrulaması için kaydedilir
- EFT indirim uygulanmışsa `Order.eftDiscountAmount` ve `Order.eftDiscountRateSnapshot` dolu olmalı
- EFT indirim **platform tarafından absorbe edilir**: müşteri toplamı azalır, fakat satıcı `Payout.grossAmount`/`netAmount` değerleri etkilenmez. Bu yüzden indirim için satıcı ledger entry'si **yazılmaz**; ledger sadece müşteri tarafındaki tahsilatla mutabıktır
- `AdminAuditLog` (actionType: `bank_transfer_approved`) yazılır

### Payout Transfer Snapshot
`Payout.markPaid` modal'ı çalıştığında şu alanlar doldurulmalıdır:
- `transferDate`, `transferReference`, `transferBankName`, `transferNote`
- `paidByAdminId` (admin actor)
- `ibanSnapshot`, `accountHolderSnapshot` (banka detayı o anki active kayıttan)
- `SellerLedgerEntry` (type: `payout`, negatif) tek seferlik yazılır; tekrar tetikleme idempotent olmalıdır
- `AdminAuditLog` actionType: `payout_released`, transfer alanları snapshot olarak loglanır

---

## 10. Chargeback Yönetimi

Chargeback gerçekleşirse:

1. `Payment.status = chargebacked` yapılır
2. `SellerLedgerEntry` (type: `chargeback`, negatif tutar) eklenir
3. İlgili payout varsa `payout_blocked` yapılır, `blockedReason` güncellenir
4. Admin inceleme akışı başlar
5. Satıcı bakiyesi negatife düşebilir; bu durum sonraki payoutlarda mahsup edilir
6. `AdminAuditLog` kaydı tutulur

---

## 11. Mutabakat Sistemi Tasarım Kısıtları

- Mutabakat job'ları idempotent olmalıdır: aynı dönemi tekrar işlediğinde çift kayıt üretmez
- Mutabakat uyarıları append-only bir kuyruğa (veya admin görünümüne) yazılır
- Uyarı kapatma aksiyonu `AdminAuditLog`'a kaydedilir
- Ledger tutarlılık koşulu `balanceAfter` zinciriyle kod seviyesinde doğrulanabilir olmalıdır
- Payout batch işlemi kısmi başarısızlık senaryosunu destekler; başarısızlık geri alınamaz batch onaylarını etkilemez

### Komisyon KDV cutover'ı (2026-07-09)

2026-07-09'dan itibaren komisyon KDV-dahil hesaplanır ve satıcı kuponu komisyon tabanını
düşürür (taban = `OrderLine.totalPrice - OrderLine.couponDiscountAmount`,
`commissionAmount = roundMoney(taban × commissionRate × (1 + commissionVatRate))`). Yeni
formüller yalnızca sipariş anında snapshot alınan **yeni** siparişlerde geçerlidir.

Cutover öncesi (2026-07-09'dan önce) onaylanmış siparişlerin komisyon snapshot'ları
**KDV'siz** oranla yazıldı. Mutabakatta bu dönem kayıtları için beklenen değer
`commissionAmount = commissionBase × commissionRate` (KDV çarpanı **yok**) olmalıdır; bu
kayıtlar `(1 + commissionVatRate)` çarpanıyla yeniden hesaplanmaya çalışılmamalıdır. Satıcı
kuponu bulunmayan tarihi kayıtlarda taban `OrderLine.totalPrice`'a eşittir. Bkz.
`docs/01-business/commission-policy.md`, `.claude/rules/12-production-readiness.md`.

### Yuvarlama cutover'ı (2026-07-03)

Payout, ceza ve satıcı fatura hesapları bu tarihte `toDecimalPlaces(2)` yuvarlamasından
`roundMoney` kuralına (3. ondalık ≤5 truncate, ≥6 yukarı) geçirildi. Cutover öncesi
persist edilmiş kayıtlar eski yuvarlamayla yazıldığı için tarihi kayıtlar yeniden
hesaplanırken satır başına en fazla 0,01 TL fark görülebilir. Mutabakat kontrollerinde
cutover öncesi kayıtlar için **±0,01 TL tolerans** uygulanır; cutover sonrası kayıtlarda
tolerans yoktur. Bkz. `.claude/rules/12-production-readiness.md` §12,
`tests/unit/rounding-parity.test.ts`.

---

## 12. Çapraz Referanslar

- `.claude/rules/07-marketplace-finance-rules.md` — mutabakat gereksinim kuralları
- `docs/07-operations/payout-lifecycle.md` — payout durumları ve batch akışı
- `docs/07-operations/order-lifecycle.md` — sipariş finans zaman damgaları
- `docs/06-engineering/queue-jobs-plan.md` — BullMQ job detayları ve zamanlama
- `docs/06-engineering/event-status-model.md` — status geçiş matrisi
- `docs/05-security/audit-logging-plan.md` — admin audit log yapısı
- `db/schema/schema.prisma` — `SellerLedgerEntry`, `Payout`, `AdminAuditLog` modelleri
