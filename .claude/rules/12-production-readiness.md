# Production Readiness — Güncel Durum

## Durum Özeti

Uygulamanın ana storefront, seller panel ve admin panel akışları gerçek backend katmanına bağlıdır.
Bu dosyanın amacı artık “hangi sayfa mock” tablosu tutmak değil, production'a çıkış öncesi kalan gerçek boşlukları özetlemektir.

Seller document / KYC akışı için migration, service, route ve test kapsamı repoda mevcuttur.
Frontend tarafında hardcoded mock data ile yeni akış üretmek kabul edilmez.

## Kalan Gerçek Açıklar

### 1. Production ortam değişkenleri
- Coolify / production ortamında ödeme, R2, Meilisearch, SMTP, EFT banka bilgileri ve panel URL değişkenleri eksiksiz girilmeli.
- Deploy öncesi `pnpm check-env --env=prod` çalıştırılmalı.
- `DATABASE_URL` ve `REDIS_URL` platform tarafından sağlanıyorsa final değerler doğrulanmalı.
- `PLATFORM_BANK_NAME`, `PLATFORM_BANK_HOLDER` ve `PLATFORM_BANK_IBAN` boş bırakılırsa EFT sipariş e-postasında fallback mesajı gösterilir.

### 2. Domain ve panel URL kararı
- Storefront, seller panel ve admin panel için kullanılacak final domainler netleştirilmeli.
- `NEXT_PUBLIC_APP_URL`, `SELLER_PANEL_URL`, `ADMIN_PANEL_URL` ve auth callback URL'leri bu karara göre hizalanmalı.

### 3. Shipping sabitlerinin tek kaynakta tutulması
- Ücretsiz kargo eşiği ve sabit kargo ücreti tek domain modülünden tüketilmeli.
- UI önizlemesi ile backend finans hesabı arasında literal drift oluşmasına izin verilmez.

### 4. Build / deploy gate doğrulaması
- CI `pnpm build` adımı production-benzeri placeholder env ile yeşil olmalı.
- Build sırasında import edilen servis yardımcıları top-level env throw ile derlemeyi kırmamalı.
- DB bağımlı sayfalar build-time prerender zorunluluğu taşımamalı.

### 5. iyzipay teknik borcu
- `iyzipay` CommonJS paketidir; build warning geri dönerse ayrıca not düşülmeli.
- Öncelikli yaklaşım warning'i config ile kapatmaktır; warning kalırsa kabul edilen teknik borç olarak açıkça belgelenmelidir.

### 6. Ürün moderasyon feature flag (`AUTO_APPROVE_CLEAN_PRODUCTS`)
- Varsayılan **kapalı** (`false`). Tüm satıcı ürünleri `pending_review` ile gelir; içerik tarama bulgu üretmediğinde bile admin onayı gerekir.
- Flag açıldığında bulgu çıkmayan ürünler doğrudan `published` olur. Açma kararı operasyon ekibinindir; rollout kriteri belirlenmeden açılmamalı.
- Sadece submit yolunda çalışır; mevcut katalog için backfill ayrıdır ve otomatik değildir.
- `.env.example` ve `tools/scripts/check-env.ts` flag'i bilir; production değeri Coolify env ekranından yönetilir.

### 7. Satıcı panel URL ile ürün içe aktarma
- Hipicon mağaza URL importu satıcı panelde `/urunler/ice-aktar` rotasındadır.
- Önizleme `POST /api/seller/products/import/preview`, kalıcı kayıt `POST /api/seller/products/import/commit` ile yapılır.
- Commit yalnızca oturumdaki aktif satıcının hesabına ürün yazar; admin adına veya başka satıcı adına import yolu yoktur.
- Excel/XLSX `Toplu Yükle` akışı ayrı kalır ve URL importundan bağımsızdır.
- Unit test `tests/unit/import-category-match.test.ts` seller-panel helper kopyasına yönlendirilmiştir.
- Hipicon adapter `shortDescription`, `stockQuantity` ve `categoryPath` alanlarını çeker; `shortDescription` bilinmiyorsa `description`'ın ilk cümlesi kullanılır, stok bilinmiyorsa `0` yazılır.
- Önizleme `proposedBarcode` (seller-prefix'li, 13 haneli) döndürür; satıcı barkodu manuel düzenleyebilir.
- Barkod gerçek zamanlı `POST /api/seller/products/barcode/check` ile doğrulanır; çakışırsa "Bu barkod zaten kullanımda" uyarısı gösterilir, commit engellenir.
- Varyantsız ürünlerde barkod commit'te zorunludur; variant'lı ürünlerde ana ürün barkodu yazılmaz, variant barkodları seller-prefix'li otomatik üretilir.
- Hipicon kategori yolu bizim kategori ağacıyla en az 2 seviye eşleşmiyorsa ürün önizlemeden filtrelenir, `rejected` listesinde gösterilir.
- Tam eşleşme yoksa ama 2+ seviye eşleşip 1 yaprak eksikse, commit anında o yaprak `Category.createdViaImportBy = sellerId` ile otomatik açılır.
- Tek yapraktan derin auto-create yapılmaz (`too_divergent` → reddedilir).

### 8. Müşteri PII satıcı görünürlüğü
- Satıcıya dönen sipariş payload'ları (detay, queue listesi, CSV export) müşteri e-postasını içermez; ad `maskCustomerName` ile "Ahmet Y." formatında gösterilir.
- Kalıcı email aliasing altyapısı (Faz 4) ayrı epic; geldiğinde aynı select noktasına alias alanı eklenir.
- Müşteri teslimat telefonu (`address.phone`) kargo/teslimat operasyonu satıcıya ait olduğu için satıcı sipariş payload'larında HAM görünür (iş sahibi kararı, 2026-07-03). E-posta gizli kalır, ad `maskCustomerName` ile maskelenir. `api/repositories/order.repository.ts` içindeki `sellerVisibleAddressSelect` bu kararı üstte kod içi yorumla belgeler; `tests/security/seller-cannot-see-customer-email.test.ts` müşteri e-postasının seçilmediğini doğrular ve telefonun izinli-ham durumunu ayrı bir testte belgeler.

### 9. Geç sevkiyat günlük ceza birikimi (yeni — 2026-05-09)
- `fulfillment-risk` BullMQ worker artık günlük %1 ceza birikimini idempotent şekilde işler ve 20. günde `cancelled_due_to_20day_breach` auto-cancel + refund tetikler.
- Eski `fulfillment_20day_breach` reason'ı yeni kayıt üretmez; mevcut kayıtlar audit için korunur.
- Production cutover sırasında worker çalışıyor olmalı; aksi halde ceza birikimi durur.

### 10. Admin payout transfer modal & seller invoice akışları
- `Öde` modal'ı `Payout.markPaid` çağrısında `transferDate`, `transferReference`, `transferBankName`, `transferNote`, `paidByAdminId`, `ibanSnapshot`, `accountHolderSnapshot` snapshot'ı yazar.
- `SellerInvoice` (commission/penalty) yalnızca admin tarafından oluşturulabilir; `invoiceNumber` global unique. Production'a açılmadan önce ilk admin kullanıcılarının `createdByAdminId` foreign-key kısıtını doğru taşıdığı kontrol edilmeli.
- TODO: `SellerInvoice` create flow şu an ledger entry yazmıyor; commission/ceza fatura kaydının `seller_ledger_entry` `commission_invoice_issued` / `penalty_invoice_issued` türünde tek bir entry üretmesi finance reporting için arzu edilir. Bu eksik şu an blocking değil ama reconciliation raporlarında "fatura kesildi mi?" sorgusu sadece `seller_invoices` tablosunu okumalıdır.

### 11. Sepet/Checkout finans breakdown (yeni — 2026-05-09)
- Sepette `netSubtotal` + oran-bazlı `taxBreakdown`; checkout'ta ek `eftDiscount` satırı (yalnızca `paymentMethod = eft` ve `eftDiscountRate > 0`).
- EFT indirimi platform-absorbe: `Order.eftDiscountAmount` müşteri toplamından düşer fakat satıcı `Payout.grossAmount`/`netAmount`'unu etkilemez. Bu yaklaşımı değiştirmek isteyen herhangi bir politika kararı önce finance docs'ta güncellenmeli.
- Order persistence: `netSubtotal`, `taxBreakdownJson`, `eftDiscountAmount`, `eftDiscountRateSnapshot` snapshot olarak yazılır; admin sipariş detayı bu snapshot'lardan render eder.

### 12. Para yuvarlama (`roundMoney`) — birleştirildi (2026-07-03)
- `packages/security/src/money.ts` 3. ondalık kuralını uygular (≤5 truncate, ≥6 yukarı yuvarla). Fixture testleri: `tests/unit/round-money.test.ts` + sınır davranışı için `tests/unit/rounding-parity.test.ts`.
- Birleştirme tamamlandı: `payout-calculator.ts`, `penalty-calculator.ts` ve `seller-invoice.service.ts` nihai para tutarlarında artık `roundMoney` kullanır (`toDecimalPlaces(2)` kaldırıldı; oran/etiket değerleri — ör. günlük ceza oranı `toDecimalPlaces(4)` — para tutarı olmadığı için değişmedi).
- Cutover notu: birleştirme öncesi persist edilmiş payout/ceza/fatura kayıtları eski yuvarlamayla yazıldı; mutabakatta tarihi kayıtlar için ±0,01 TL tolerans uygulanır (bkz. `docs/07-operations/reconciliation-process.md`).

### 13. Variant stoğu içe aktarma
- URL importu varyantsız ürünler için per-product `stockQuantity` input'u sağlar.
- Variant'lı ürünlerde stoğun hangi variant'a yazılacağı henüz seçilemez — ana ürün düzeyinde yazılır. Variant-bazlı stok girişi ayrı bir epic.

### 14. Kupon seller-scope + sipariÅŸ numarasÄ± sequence operasyonu (yeni â€” 2026-05-14)
- `Coupon.sellerId` migration'Ä± deploy zincirinin parÃ§asÄ±dÄ±r; `sellerId = NULL` kuponlar platform-wide kalÄ±r, dolu olan kuponlar yalnÄ±zca ilgili satÄ±cÄ± subtotal'una uygulanÄ±r.
- `orders_publicNumber_seq` 2026 cohort için `26050000` seviyesine bump edilmiştir; ilk yeni sipariş `26050001` (8 hane, yıl prefix `26`).
- 2027 yılbaşı operasyon görevi: `ALTER SEQUENCE "orders_publicNumber_seq" RESTART WITH 27050000;` çalıştırılmalı ve ilk yeni siparişte smoke test yapılmalıdır.

### 15. Satıcı odaklı iade + uyuşmazlık eskalasyonu (yeni — 2026-05-15)
- Migration `20260515140000_seller_driven_return_flow` deploy zincirinin parçasıdır
  (additive; `return_requests` yeni alanlar, `return_requests.disputeId` FK/unique,
  `media_assets.returnMessageId` FK). Deploy öncesi `prisma migrate deploy` + client generate.
- İade penceresi **14 takvim günü** ve **kesin** kapanır: pencere sonrası
  `openRequest` backend tarafından reddedilir, storefront butonu pasif/gizli olur.
  Eski "14 gün sonrası admin değerlendirmesi" yolu kaldırıldı (politika kararı).
- Satıcı "Kargoyu Aldım" onayı **otomatik müşteri iadesini** tetikler
  (`refund.service`, idempotent — `ReturnRequest.refundedAt` guard). Kart → Iyzico,
  EFT → manuel. Negatif `SellerLedgerEntry` (`refund`) yazılır.
- Satıcı reddi otomatik `Dispute` (open, payoutBlocked) açar; konuşma tek
  `ReturnMessage` thread'inde devam eder. Admin uyuşmazlığı sonuç metni + (müşteri
  lehine ise opsiyonel tutar) ile kapatır; tutar girilirse aynı idempotent refund yolu.
- Bilinen sınır: kısmi iade modellenmedi (satıcı payı tam iade); çok satıcılı
  siparişte yalnız ilgili satıcı satırları iade edilir. Satıcı tarafı timeout'ları
  (kargo bilgisi/onay gecikmesi) şimdilik admin override route'ları ile elle yönetilir;
  SLA job ayrı bir takip işidir.
- (2026-07-03 güncellemesi) Eski typecheck kırıkları giderildi; `pnpm typecheck` yeşil.
  `@hanuja/api` paketi artık kendi `typecheck` script'ine sahip (worker/jobs dosyaları
  dahil). Not: api tsconfig'de `exactOptionalPropertyTypes` ve `noUncheckedIndexedAccess`
  ilk etapta kapalı — sıkılaştırma ayrı temizlik işi.

### 16. Ödeme bağlama doğrulaması + providerPaymentId unique (yeni — 2026-07-03)
- `confirmCardPayment` artık tutar eşitliği (`paidPrice == Order.totalAmount`) ve
  providerRef tekrar kullanımını fail-closed doğrular; callback `conversationId` echo
  ve `fraudStatus=-1` kontrolü yapar. Bkz `docs/05-security/payment-security.md` §7.
- Migration `20260703100000_payment_provider_payment_id_unique` deploy zincirinin
  parçasıdır. **Deploy öncesi** prod'da duplicate kontrolü çalıştırılmalı:
  `SELECT "providerPaymentId", count(*) FROM payments WHERE "providerPaymentId" IS NOT NULL GROUP BY 1 HAVING count(*) > 1;`
  Satır dönerse migration başarısız olur; önce elle mutabakat gerekir.

## Operasyonel Not

Yeni feature veya sayfa eklerken production readiness varsayılanı şudur:
- gerçek backend entegrasyonu
- gerçek domain kuralı
- build-safe import davranışı
- env bağımlılıklarının açık tanımı

## Kural

Bu dosya production readiness durumunu güncel ve kısa tutar.
Eski “mock / çalışmıyor” listeleri burada biriktirilmez.
Yeni sayfa eklerken mutlaka gerçek backend entegrasyonu yap — hardcoded mock data YASAK.
