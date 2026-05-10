# Son güncelleme: 2026-04-18
# Durum: taslak v1

# Payout Lifecycle — Satıcı Ödeme Döngüsü

Kaynak kurallar: `.claude/rules/07-marketplace-finance-rules.md`, `.claude/rules/08-order-lifecycle-rules.md`, `CLAUDE.md §2.2, §2.3, §15.3`

---

## 1. Temel İlke

Satıcı ödemesi yalnızca `delivery_confirmed` sonrasında başlar.

Aşağıdaki durumlar payout sayacını **başlatmaz**:

| Durum | Payout başlar mı? |
|-------|------------------|
| `payment_confirmed` | Hayır |
| `seller_accepted` | Hayır |
| `shipped` | Hayır |
| `delivered` | Hayır |
| `delivery_confirmed` | **Evet — sayaç buradan başlar** |

`delivered` ile `delivery_confirmed` arasındaki fark platform sabiti olarak uygulanır. Hiçbir kod, yorumlama veya kısayol bu ayrımı geçersiz kılamaz.

---

## 2. Payout Sayacı Nasıl Başlar

`order.deliveryConfirmedAt` alanına zaman damgası yazılır. Bu değer üç yoldan biriyle oluşur:

1. Müşteri "Teslim Aldım" butonuna basar
2. Admin manuel olarak `delivery_confirmed_manual` aksiyonunu uygular (`AdminAuditLog`'a kaydedilir)
3. BullMQ sessiz onay job'ı: sipariş `delivered` durumuna geçtikten 72 saat sonra müşteri itiraz açmamışsa sistem otomatik `delivery_confirmed`'e geçirir

`Payout` kaydı oluşturulur:
- `status = hold_active`
- `holdStartedAt = deliveryConfirmedAt`
- `holdUntil = deliveryConfirmedAt + 30 gün`

---

## 3. 30 Günlük Bekleme Dönemi

`delivery_confirmed` tarihinden itibaren 30 gün bekletme zorunludur.

Bu süre içinde sistem şunları değerlendirir:

- Açık iade talebi var mı?
- Açık uyuşmazlık var mı?
- Chargeback riski var mı?
- Admin tarafından konulan hold var mı?
- Satıcının banka bilgisi doğrulanmış mı?
- Satıcının negatif bakiyesi var mı (mahsup uygulanacak)?
- Fraud veya risk incelemesi açık mı?
- Tutarsız finans kaydı var mı?

Bu süre toplu ödeme tarihiyle kısaltılamaz. Satıcı haftalık/aylık batch döngüsüne girse bile, bireysel sipariş seviyesindeki 30 günlük hold koşulu geçerliliğini korur.

---

## 4. Payout Durumları

| PayoutStatus | Açıklama |
|-------------|----------|
| `hold_active` | 30 günlük bekleme süresi devam ediyor |
| `payout_blocked` | Bloke eden koşul var; ödeme yapılamaz |
| `payout_ready` | Tüm kontroller geçti; batch'e alınabilir |
| `payout_scheduled` | Toplu ödeme batch'ine dahil edildi |
| `payout_paid` | Banka transferi gerçekleşti |

Bir payout `payout_blocked` durumuna düşerse `blockedReason` alanı doldurulur ve satıcı panelinde görünür hale gelir.

---

## 5. Payout Bloklama Koşulları

Aşağıdaki koşullardan herhangi biri karşılandığında payout `payout_blocked` olarak işaretlenir veya `hold_active` durumunda tutulur:

| Koşul | Kaynak |
|-------|--------|
| Açık iade talebi (`return_requested`, `return_under_review`) | `ReturnRequest` tablosu |
| Açık uyuşmazlık (`dispute_open`, `under_review`) | `Dispute.payoutBlocked = true` |
| Admin hold (`payout_blocked` aksiyonu) | `AdminAuditLog` |
| Banka bilgisi doğrulanmamış | `SellerBankDetail.isVerified = false` |
| Aktif banka bilgisi yok | `SellerBankDetail.isActive = false` |
| Fraud/risk incelemesi açık | Risk motoru işareti |
| Negatif bakiye mahsup bekleniyor | `SellerLedgerEntry` hesaplaması |
| Tutarsız finans kaydı | Reconciliation job uyarısı |

Tüm koşullar temizlendiğinde BullMQ payout-maturity job'ı `payout_ready` durumuna geçirir.

---

## 6. Net Payout Formülü

Payout oluşturulurken her kalem ayrı ayrı hesaplanır ve `Payout` tablosuna yazılır:

```
net_amount = gross_amount
           - commission_amount
           - coupon_share_amount
           - cargo_charge_amount
           - ad_fee_amount
           - penalty_amount
           - refund_amount
           ± adjustment_amount   (admin manuel düzeltme)
```

Negatif bakiye carryover varsa `adjustment_amount` alanı eksi değer alır.

Hiçbir kalem "genel kesinti" başlığı altında gizlenemez. Her satır `SellerLedgerEntry`'de ayrı bir kayıt olarak tutulur.

### Komisyon Çözüm Sırası

Komisyon oranı şu öncelik sırasıyla belirlenir:

1. Ürüne özgü override oranı
2. Kategori oranı
3. Satıcı genel oranı
4. Sistem varsayılan oranı

Bu değer `OrderLine.commissionRate` alanında sipariş anında snapshot olarak saklanır.

---

## 7. Satıcı Ledger Entegrasyonu

Her payout hareketi `SellerLedgerEntry` tablosuna yazılır (immutable, append-only):

| Hareket | LedgerEntryType |
|---------|----------------|
| Satış geliri kaydı | `sale` |
| Komisyon kesintisi | `commission` |
| Kargo kesintisi | `cargo_charge` |
| Reklam/hizmet ücreti | `ad_fee` |
| Ceza kesintisi | `penalty` (seller rejection %20 veya late shipment daily accrual) |
| İade etkisi | `refund` |
| Kupon payı | `coupon_share` |
| Admin düzeltme | `manual_adjustment` |
| Ödeme çıkışı | `payout` |
| Chargeback | `chargeback` |
| Uyuşmazlık bloku | `dispute_hold` |
| Uyuşmazlık serbest bırakma | `dispute_release` |

Her kayıt `balanceAfter` alanını günceller. Ledger overwrite yapılmaz.

---

## 8. Toplu Ödeme (Batch) Akışı

Hanuja satıcıları haftalık, iki haftalık veya aylık batch döngüleriyle ödeyebilir.

### Batch Oluşturma
1. BullMQ payout-maturity job'ı `holdUntil <= now` ve `status = hold_active` olan kayıtları tarar
2. Bloke koşulları yoksa `status = payout_ready` yapılır
3. Admin payout-ready batch adaylarını listeler
4. Admin batch oluşturur (`PayoutBatch` kaydı, `reference` numarasıyla)
5. `Payout.status = payout_scheduled`, `Payout.batchId` atanır

### Batch Onaylama
1. Admin batch'i gözden geçirir: toplam tutar, satıcı sayısı, bloke durumlar
2. Onay verir; sistem `processedBy`, `processedAt` alanlarını doldurur
3. Her payout için banka transferi başlatılır
4. Başarılı transferde `status = payout_paid`, `paidAt` doldurulur
5. `SellerLedgerEntry` (type: `payout`) eklenir
6. `AdminAuditLog` (actionType: `payout_released`) yazılır

### Kısmi Başarısızlık
Batch içinde bir transfer başarısız olursa:
- O payout tekrar `payout_blocked` durumuna döner, `blockedReason` güncellenir
- Diğer ödemeler etkilenmez
- Admin bilgilendirilir

---

## 9. Admin Payout Release Akışı

Admin `payout_blocked` durumundaki bir payout'u manuel serbest bırakabilir.

Adımlar:
1. Admin `payout_hold_released` aksiyonunu uygular
2. Gerekçe zorunludur (metin alanı)
3. `AdminAuditLog` kaydı oluşturulur: aktör, zaman, önceki durum, yeni durum, gerekçe
4. Payout `payout_ready` durumuna geçer
5. Sonraki batch döngüsüne dahil edilir

Manual override için sadece yüksek yetkili admin (`finance_admin` veya `super_admin`) aksiyonu uygulayabilir.

---

## 10. Satıcının Her Aşamada Gördükleri

| Payout Durumu | Satıcı Panelinde Gösterilen |
|--------------|----------------------------|
| `hold_active` | "Beklemede — X tarihine kadar" (holdUntil gösterilir) |
| `payout_blocked` | "Bloke — [sebep]" (blockedReason satıcı-güvenli versiyonu) |
| `payout_ready` | "Ödeme Hazır" |
| `payout_scheduled` | "Ödeme Planlandı — Batch #REF" |
| `payout_paid` | "Ödendi — [tarih] [tutar]" |

Satıcı tek bir cüzdan bakiyesi değil, aşamalı ayrıştırılmış görünüm görür:

- Beklemedeki kazanç (hold_active toplamı)
- Bloke kazanç (payout_blocked toplamı)
- Ödemeye hazır kazanç (payout_ready toplamı)
- Ödenmiş kazanç (payout_paid toplamı)
- Kesintiler (komisyon, kargo, ceza, iade)
- Negatif bakiye (varsa)

---

## 11. Negatif Bakiye Yönetimi

Negatif bakiye aşağıdaki durumlarda oluşur:

- Ceza uygulanır ve payout toplamı cezayı karşılamaz
- Ödeme yapıldıktan sonra iade kesinleşir
- Admin manuel borç kaydı ekler

Negatif bakiye kural seti:
1. Satıcı panelinde açıkça gösterilir
2. Sonraki payoutlarda otomatik mahsup uygulanır
3. Admin negatif bakiyeyi etkileyen manuel işlemleri loglar
4. Bakiye sıfırlanana kadar her payout döngüsünde carryover devam eder

---

## 12. İade Sonrası Payout Etkisi

### İade payout'tan önce kesinleşirse
- İlgili tutar payout'tan düşülür veya `refund_amount` artırılır
- Satıcı düşülmüş net tutarı alır
- `SellerLedgerEntry` (type: `refund`) yazılır

### İade payout'tan sonra kesinleşirse
- Satıcı ledgerına borç kaydı (`refund` tipi, negatif tutar) eklenir
- Negatif bakiye oluşur
- Sonraki payout döngülerinde mahsup edilir

---

## 13. BullMQ Job Sorumluluğu

Payout lifecycle otomasyonu için aşağıdaki job'lar gereklidir:

| Job | Tetikleyici | Görev |
|-----|-------------|-------|
| `payout-maturity` | Periyodik (günlük) | `holdUntil` dolmuş ve koşullar temiz payoutları `payout_ready` yapar |
| `delivery-silent-confirm` | `delivered` geçişinden 72 saat sonra | İtiraz yoksa `delivery_confirmed`'e geçirir |
| `payout-batch-prepare` | Admin tetiklemesi veya zamanlı | `payout_ready` kayıtlarını batch'e toplar |

Her job idempotent olmalıdır. Yeniden çalıştırma durumunda çift payout veya çift ledger kaydı oluşturmamalıdır.

---

## 14. Çapraz Referanslar

- `.claude/rules/07-marketplace-finance-rules.md` — net payout formülü, bloke koşulları
- `.claude/rules/08-order-lifecycle-rules.md` — delivery_confirmed ayrımı
- `docs/07-operations/order-lifecycle.md` — sipariş akışıyla bağlantı noktaları
- `docs/07-operations/reconciliation-process.md` — ledger tutarlılığı kontrolü
- `docs/01-business/payout-policy.md` — payout politikası
- `docs/06-engineering/queue-jobs-plan.md` — BullMQ job detayları
- `docs/05-security/seller-iban-verification.md` — banka bilgisi doğrulama akışı
