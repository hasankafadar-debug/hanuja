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
- AWS SDK paketleri caret aralığında güncellendiğinde yeni varsayılan davranışlar production akışını değiştirebilir. R2 browser presign client'ı `requestChecksumCalculation: 'WHEN_REQUIRED'` ayarını açıkça sabitler; bu ayar sunucu taraflı R2 client'larına genellenmez.

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
  parçasıdır. **Deploy öncesi** prod'da duplicate kontrolü artık otomatik bir guard
  script ile yapılır: `pnpm check-duplicate-payments`
  (`tools/scripts/check-duplicate-provider-payment-ids.ts`). Script canlı
  `DATABASE_URL`'e karşı çalışır, duplicate `providerPaymentId` bulursa ilişkili
  `payment.id`/`orderId` listesiyle birlikte hata basıp `exit(1)` ile döner
  (fail-closed — bağlantı/DATABASE_URL sorunu da `exit(1)` üretir). Bu script
  genel `pnpm release-check` zincirinde DEĞİLDİR; `pnpm db:migrate:deploy`'dan
  hemen önce, prod ortamına karşı ayrı bir manuel/pipeline adımı olarak
  çalıştırılmalıdır. Sıra ve detaylar:
  `docs/07-operations/production-deploy-runbook.md` adım 4.

### 17. Komisyon KDV + satıcı kupon payı (yeni — 2026-07-09)
- Migration `coupon_line_share_and_commission_vat` deploy zincirinin parçasıdır (additive):
  `OrderLine.couponDiscountAmount`, `Payout.couponShareAmount`,
  `PlatformSettings.commissionVatRate` (default `0.2000`) alanlarını ekler.
- Komisyon tabanı artık `OrderLine.totalPrice - OrderLine.couponDiscountAmount`; komisyon
  kesintisi KDV-dahil hesaplanır: `roundMoney(taban × commissionRate × (1 + commissionVatRate))`.
  Satıcı kuponu (`Coupon.sellerId` dolu) satıcının ilgili satırlarına oransal dağıtılır ve
  hem komisyon tabanını hem net hakedişi düşürür. Platform kuponu (`sellerId = NULL`) ve EFT
  indirimi davranışı değişmedi — platform absorbe eder, satır snapshot'ları tam fiyat.
  Bkz. `docs/01-business/commission-policy.md`, `docs/01-business/payout-policy.md`,
  `.claude/rules/07-marketplace-finance-rules.md`.
- **Cutover:** yeni formüller yalnızca 2026-07-09 ve sonrası onaylanan siparişlerde
  (sipariş anı snapshot) geçerlidir. Bu tarihten önceki siparişlerin komisyon snapshot'ları
  KDV'siz oranla yazıldı ve öyle kalır; mutabakatta bu tarihi kayıtlar için
  `commissionAmount = taban × commissionRate` (KDV çarpanı yok) beklenir. Bkz.
  `docs/07-operations/reconciliation-process.md` §4.2 ve §11.
- Satıcı panelinde kupon CRUD eklendi (kod, yüzde/sabit indirim, `maxUsageTotal`,
  `expiresAt`, opsiyonel min sepet tutarı). Satıcı kuponu yalnızca o satıcının ürünlerinde
  geçerlidir; checkout'ta ilgili satıcının subtotal'ına uygulanır.
- Payout onarım script'i eklendi: `pnpm payout:repair`
  (`tools/scripts/repair-missing-payouts.ts`) — `delivery_confirmed` durumundaki ama
  `Payout` kaydı bulunmayan siparişleri tarar ve onarır. Aynı tarama artık
  `payout-maturity` job'ına kalıcı bir sweep adımı olarak da eklendi (periyodik, idempotent).
  Tetikleyici olay: sipariş #231655, 2026-05-08'de admin onayına rağmen payout kaydı
  oluşmamıştı; bu script ve sweep bu sınıf hatayı kalıcı olarak kapatır.

### 18. E-posta altyapısı + kampanya rıza kapısı (2026-07-17)
- **Sağlayıcı güncellemesi (2026-07-18):** Amazon SES production erişimi onaylanmadığı
  (hesap sandbox'ta kaldığı) için outbound SMTP sağlayıcısı **Resend** oldu — bkz. §19.
  Kod değişmedi (`api/lib/mailer.ts` provider-agnostik SMTP); yalnızca env değerleri ve
  DNS kayıtları değişti. Kök domain MX/SPF (Promail, `admin@hanuja.com.tr` kurumsal
  kutusu) her iki sağlayıcıda da **değiştirilmedi**; DMARC (`p=none`) DKIM hizalamasıyla
  geçer. Detay: `docs/06-engineering/integrations.md` §6.
- Mailer artık kategori bazlı gönderen adresi kullanıyor (`noreply` / `fatura` / `kampanya`,
  `EMAIL_FROM_*` env, `SMTP_FROM`'a fallback). `invoice_uploaded` → `fatura` (Reply-To
  `admin@hanuja.com.tr`); `store_discount_followed_seller` + yeni `product_discount_*`
  bildirimleri → `kampanya`; geri kalan her şey → `noreply`.
- **Kampanya rıza kapısı:** yeni `MarketingConsent` modeli (tek signup checkbox hem email hem
  SMS zaman damgasını set eder, `optOutToken` ile oturumsuz global opt-out) ve
  `CampaignEmailDispatch` (fingerprint + cooldown dedupe) eklendi. `product_discount_favorited`
  / `product_discount_in_cart` e-postaları yalnızca aktif (geri çekilmemiş) rızası olan
  kullanıcılara gider. **Not:** mağaza takip indirim bildirimleri (`store_discount_followed_seller`)
  hâlâ eski per-follow opt-out ile yönetiliyor, `MarketingConsent`'e tabi DEĞİL — bu iki rıza
  mekanizması karıştırılmamalı.
- Migration `20260717120000_campaign_discount_marketing_consent` deploy zincirinin parçasıdır
  (additive). Yeni `campaign-discount` BullMQ kuyruğu (`fan-out` + 15 dakikalık
  `activation-scan`) worker'da çalışıyor olmalı — bkz.
  `docs/06-engineering/queue-jobs-plan.md` §"campaign-discount".

**Bilinen açık uçlar (takip gerektirir, blocking değil):**
- Aşağıdaki transactional şablonlar henüz `escapeHtml` ile HTML-kaçışlı değil (yalnızca yeni
  `productDiscountTemplate` satıcı-kontrollü alanları escape ediyor):
  `orderConfirmationTemplate`, `shipmentNotificationTemplate`, `deliveryConfirmedTemplate`,
  `invoiceUploadedTemplate`, `returnRequestTemplate`, `payoutProcessedTemplate`,
  `penaltyAppliedTemplate`, ve bağımsız satıcı-onay/şifre şablon dosyaları. Bu şablonlardaki
  alanların çoğu sistem/admin kaynaklı olsa da, satıcı/müşteri girdisi içeren alanlar (ör.
  ürün adı, red gerekçesi) için escape kapsamı genişletilmeli.
- **Signup rıza oturum boşluğu:** kayıt formundaki rıza checkbox'ı işaretlenip gönderilse bile,
  kayıt sonrası aktif oturum oluşmazsa (ör. e-posta doğrulama akışı araya girerse) rıza niyeti
  o anda kalıcı hale gelmeyebilir. Kullanıcı `hesabim/iletisim-tercihleri` sayfasından yeniden
  rıza verebilir; bu bir veri kaybı değil, kullanıcı eylemi gerektiren bir boşluktur.
- Satıcı panel indirim CRUD route'ları ve `/api/marketing/unsubscribe` için route-seviyesi test
  kapsamı eksik — servis/domain seviyesi testler mevcut, route-seviyesi entegrasyon testi ayrı
  bir iş.
- `.env.example` dosyasına `EMAIL_FROM_NOREPLY` / `EMAIL_FROM_FATURA` / `EMAIL_FROM_KAMPANYA`
  placeholder satırları elle eklenmelidir — bu dosya agent izin kısıtı nedeniyle
  güncellenemedi; `tools/scripts/check-env.ts` zaten bu değişkenleri tanıyor.
  (`docs/05-security/secrets-env-policy.md` SMTP tablosuna bu üç değişken 2026-07-18'de
  eklendi — o kısım kapandı.)
- Postmark RET (fatura e-postasına yanıt) akışı artık global kampanya rızasını da geri
  çekiyor; bu, `From` header'ı sahte/spoof edilebilir bir sinyale dayanıyor. Yön fail-safe'tir
  (rıza yanlışlıkla geri çekilebilir ama yanlışlıkla açılamaz), risk düşük ama not edilmeli.

### 19. Resend'e geçiş — outbound e-posta (yeni — 2026-07-18)
- Outbound SMTP sağlayıcısı Amazon SES'ten **Resend**'e taşındı (SES production erişimi
  hiç onaylanmadı, hesap sandbox'ta kaldı). Kod değişikliği yok — `api/lib/mailer.ts`
  saf Nodemailer SMTP'dir; geçiş = Resend domain doğrulaması (DNS) + Coolify env
  değişimi. Detay: `docs/06-engineering/integrations.md` §6,
  `docs/07-operations/production-deploy-runbook.md` §"SMTP / e-posta doğrulaması".
- **Cutover adımları (ops, sırayla):**
  1. Resend panelinde `hanuja.com.tr` domaini eklenir (bölge `eu-west-1`); panelin verdiği
     DNS kayıtları girilir: `resend._domainkey` TXT (DKIM) + `send.hanuja.com.tr` MX/TXT
     (return-path). Kök MX/SPF (Promail) **DEĞİŞTİRİLMEZ**.
  2. Domain **Verified** olunca Sending yetkili API key üretilir.
  3. 4 Coolify servisinde (`web`, `seller-panel`, `admin-panel`, `worker`):
     `SMTP_HOST=smtp.resend.com`, `SMTP_PORT=465`, `SMTP_USER=resend` (literal),
     `SMTP_PASS=<Resend API key>`; `SMTP_FROM` / `EMAIL_FROM_*` aynı kalır. Redeploy.
  4. Smoke test: şifre sıfırlama maili → teslimat + `DKIM=pass`; Resend dashboard
     loglarında `Delivered` görülmeli.
- **Kota:** free tier 100 e-posta/gün / 3.000 e-posta/ay — kampanya fan-out'u için
  yetersizdir; geniş kampanya gönderimi öncesi ücretli plan şart (eski "SES sandbox"
  uyarısının yerini bu kota uyarısı alır).
- Bounce/complaint için app-side webhook yok — Resend dashboard suppression listesi
  şimdilik yeterli; webhook + uygulama içi suppression ertelenen açık iştir.
  Inbound e-posta (Postmark fatura aliasing + RET opt-out) bu geçişten etkilenmedi.
- **SES yedekte kalır (iş kararı, 2026-07-18):** SES DNS kayıtları (3 DKIM CNAME +
  `ses.hanuja.com.tr` MX/TXT) ve SMTP credential'ı silinmez — AWS production erişimi
  ileride onaylanırsa SES'e dönüş yalnızca Coolify env değişimidir. SES credential'ının
  AWS konsolunda rotasyonu (yenisi üretilip eskisinin silinmesi) ilk fırsatta önerilir.
- Cutover 2026-07-18'de tamamlandı ve doğrulandı: 4 Coolify servisi Resend SMTP
  değerleriyle redeploy edildi; smoke test (admin şifre sıfırlama →
  `admin@hanuja.com.tr`) Resend dashboard'da `Delivered` olarak doğrulandı.

## Operasyonel Not

Yeni feature veya sayfa eklerken production readiness varsayılanı şudur:
- gerçek backend entegrasyonu
- gerçek domain kuralı
- build-safe import davranışı
- env bağımlılıklarının açık tanımı

### 20. Şifre güç politikası + Google ile müşteri girişi (yeni — 2026-07-19)
- Şifre kuralları: müşteri ≥8 karakter + ≥1 harf + ≥1 rakam; satıcı ≥8 karakter + büyük/küçük harf + rakam + sembol. Tüm şifre oluşturma noktalarında (kayıt, sıfırlama, değiştirme, ilk-şifre) istemci + route + Better Auth hooks.before katmanlarıyla zorlanır. Giriş akışları muaf — mevcut zayıf şifreli hesaplar giriş yapabilir. Admin akışları bilinçli olarak kapsam dışı (min 8).
- Google girişi yalnızca apps/web'de ve env-gated: GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET ikisi de doluysa `/giris` sayfasında “Google ile giriş yap” butonu görünür. Coolify'da yalnızca web servisine girilir.
- Google Cloud Console'da authorized redirect URI: `{BETTER_AUTH_URL}/api/auth/callback/google` (BETTER_AUTH_URL sürer; prod'da NEXT_PUBLIC_APP_URL ile aynı domain olmalı — teyit edilmeli).
- Google ile kayıt olan kullanıcı için MarketingConsent OLUŞMAZ (signup checkbox akışı); kullanıcı `hesabim/iletisim-tercihleri`'nden sonradan rıza verebilir.
- `.env.example`'a `GOOGLE_CLIENT_ID=` / `GOOGLE_CLIENT_SECRET=` placeholder satırları elle eklenmelidir (agent izin kısıtı — §18 emsali).
- Ayrıca `/hesabim` layout'una sunucu tarafı oturum guard'ı eklendi (oturumsuz kullanıcı `/giris?callbackUrl=/hesabim`'a yönlenir).

### 21. Medya host geçişi: `media.hanuja.tr` (yeni — 2026-07-22)
- Ürün görseli yükleme üst üste binmiş üç sorunla kırıktı; üçü de çözüldü. Sıra: (1) AWS SDK ≥3.729'un presigned PutObject URL'ine boş gövde CRC32 checksum'ı yazması (commit `5099260`), (2) R2 API token'ındaki Client IP filtresi, (3) `media.hanuja.com.tr`'nin DNS'te hiç var olmaması (commit `a0611d2` + DNS geçişi).
- **Medya alan adı artık `media.hanuja.tr`.** `R2_PUBLIC_URL=https://media.hanuja.tr`, `R2_PUBLIC_HOSTNAME=media.hanuja.tr`; 4 Coolify servisinde de aynı. `R2_PUBLIC_HOSTNAME` build-time okunduğu için değişiminde restart değil **redeploy** gerekir.
- **Yalnız `hanuja.tr` Cloudflare'e taşındı** (NS: `matt`/`brianna.ns.cloudflare.com`). `hanuja.com.tr` DNS ve e-posta kayıtlarına (ProMail MX/SPF, Resend DKIM, `send.` return-path, SES yedeği, DMARC) dokunulmadı ve bu bilinçli bir karardır. Ana domaini taşımak ayrı, planlı bir iş olarak ele alınmalı.
- Cloudflare'de bulut durumu: `media.hanuja.tr` **turuncu** (R2 custom domain, zorunlu); `hanuja.tr` ve `www.hanuja.tr` **gri** kalmalı — turuncuya alınırsa TLS'i Cloudflare sonlandırır ve Coolify'ın Let's Encrypt sertifikasıyla çakışıp 308 yönlendirmeyi bozar.
- Legacy `media.hanuja.com.tr` kod tarafında tanınmaya devam ediyor (`LEGACY_MEDIA_HOSTNAME`, `api/lib/media-url.ts`, `packages/ui/src/lib/media-url.ts`), bu yüzden **DB URL backfill'i gerekmedi**. `DEFAULT_MEDIA_HOSTNAME` ileride yine değişirse eski host mutlaka legacy listede kalmalı; aksi halde eski kayıtlar sessizce "yönetilmeyen" sayılır.
- **`hanuja.tr` domain yenilemesi artık iş kritik:** ürün görselleri oradan servis ediliyor, süresi dolarsa tüm katalog görselleri kırılır. Otomatik yenileme açık tutulmalı.
- R2 API token'ında **Client IP filtresi kullanılmamalı** — presigned URL tarayıcı IP'sinden kullanılır; filtreli token sunucu `HeadBucket`'ını geçer ama tarayıcı PUT'u `403` alır ve bu Chrome'da sahte CORS hatası olarak görünür. Ayrıntı: `docs/06-engineering/integrations.md` §3.
- `R2_SOURCE_BUCKET_NAME` artık hiçbir yerde kullanılmıyor: `a0611d2` değişkeni `.env.example`'dan çıkardı, `c938691` de tek tüketicisi olan `tools/scripts/copy-production-media.ts` script'ini ve `package.json` komutunu sildi. Ek işlem gerekmiyor.
- Açık takip işi: başarısız yükleme denemelerinden kalan `pending` durumundaki `MediaAsset` kayıtları temizlenmiyor; periyodik sweep yok (blocking değil).

### 22. Zorunlu yaprak kategori (toplu yükleme) + opsiyonel otomatik barkod (yeni — 2026-07-23)
- **Toplu (Excel) yükleme artık yaprağa kadar zorunlu.** Kademeli kategori seçimi son kategoriye
  inmeden şablon indirilemez/dosya yüklenemez; ara kategoride durulursa butonlar pasif. Şablon yalnız
  seçilen tek yaprağı içerir (eski "üst seviyede durup tüm alt dalları tek dosyaya alma" davranışı
  kaldırıldı — commit `208a5a0`'in broad-scope davranışı geri alındı). Sunucu ara kategoriyi
  `En alt kategoriyi seçmelisiniz.` ile reddeder (`bulk/template` + `bulk` route'ları). Tekli form da
  aynı yaprak kategori kuralını uygular.
- **Destek yönlendirmesi:** paylaşılan `CategorySupportHint` bileşeni toplu yükleme ve tekli
  ekleme/düzenleme kategori alanlarında görünür; "Admin Destek" metni `/destek`'e link.
  Satıcılar kendileri kategori oluşturamaz; talep destek bileti sistemi üzerinden.
- **Barkod artık opsiyonel (tüm yükleme yolları).** Satıcı barkodu boş bırakırsa sistem "8" ile
  başlayan, kontrol haneli **geçerli EAN-13** üretir (`api/domain/barcode-generate.ts` →
  `generateUniqueProductBarcode`; benzersizlik `barcodeRegistry` + DB unique + trigger ile). Ana
  ürün üretimi `catalog.service.createProduct`'ta merkezî (`autoGenerateBarcodeWhenMissing`);
  varyant barkodları da opsiyonel + otomatik "8" üretimi. Girilen barkodun benzersizlik kontrolü
  (realtime endpoint + registry) korunur.
- **Taksonomi iyileştirmesi:** aşırı genel kalan bazı yapraklar ara kategoriye çevrildi ve alt
  yapraklara ayrıldı (`20260723193000_refine_general_category_leaves`). Örnekler: `Sehpa Modelleri`
  → `Orta Sehpa` / `Yan Sehpa` / `Zigon Sehpa`, `Dresuar & Konsol` → `Dresuar` / `Konsol`,
  `Tavan & Sarkıt` → `Tavan Aydınlatma` / `Sarkıt Aydınlatma`, `Tabak & Kase` → `Tabak` / `Kase`
  / `Sofra Seti`, `Mum & Mumluk` → `Mum` / `Mumluk`, `Bahçe Mobilyaları` → daha somut bahçe
  mobilyası yaprakları. Migration mevcut ürünleri isim/slug ipuçlarına göre yeni yapraklara taşır;
  canlıda ürün yoksa taşıma kısmı no-op kalır.

### 23. Geniş renk paleti + iki-renk + ürün ölçüleri (yeni — 2026-07-24)
- **Renk paleti genişletildi + küratörlü sıralandı.** `db/seeds/attribute-options.ts` `COLORS` aile-gruplu
  sıraya göre yeniden düzenlendi ve 10 yeni renk eklendi: Naturel, Şampanya, Eskitme, Buz Mavisi, Mint Yeşil,
  Eskitme Altın, Rose Altın, Eskitme Gümüş, Pirinç, **Mix** (çok renkli; hex'siz). Metalik finish aileleri
  bitişik (Altın → Eskitme Altın → Rose Altın; Gümüş → Eskitme Gümüş; Bakır → Pirinç). Sıra artık
  `ProductAttributeOption.sortOrder`'dan gelir — `sortAttributeOptions` (`attribute-option-sort.ts`) ve iki
  attribute-option API'si (`/api/attribute-options`, `/api/categories/[slug]/attributes`) `sortOrder` seçip
  ona göre sıralar (alfabetik değil). Tek geniş ortak palet: `CategoryAttributeOption` seed'lenmediğinden
  yeni renkler tüm kategorilerde otomatik görünür.
- **Prod deploy adımı (reference data):** yeni renkler otomatik migration ile GİTMEZ. Deploy sonrası tek
  seferlik `pnpm attributes:seed` (`tools/scripts/seed-attribute-options.ts`) çalıştırılmalı — idempotent
  upsert (`type_slug`), mevcut ürün-renk bağlarını etkilemez, yalnız seçenek listesi + sortOrder günceller.
  Tam `pnpm db:seed` prod'da KULLANILMAZ (test verisi üretir).
- **Migration:** `20260724120000_product_attribute_value_sort_order` deploy zincirinin parçasıdır (additive):
  `ProductAttributeValue.sortOrder Int @default(0)` — tek üründe Renk 1 (0) / Renk 2 (1) sırası için.
- **İki renk (tekli form + Excel):** tekli formda "Renk Adedi" (1/2); Excel'de `Renk 1*` (zorunlu) + `Renk 2`
  (opsiyonel) sütunları. Excel'de eski `Urun Rengi*` başlığı geriye dönük kabul edilir
  (`getMissingBulkProductHeaders` legacy alias). Mağazada "Renk: Renk1 - Renk2".
- **Ürün ölçüleri (En/Boy/Yükseklik):** DB kolonları (`dimension*`) zaten vardı; artık tekli form + Excel'den
  yazılır (opsiyonel) ve girilirse ürün sayfasında stok/sevk satırının yanında gösterilir. Migration gerekmez.
  Eşleme: En → `dimensionWidth`, Boy → `dimensionLength`, Yükseklik → `dimensionHeight`.
- **Bilinen açık uç (blocking değil):** iki-renk ve ölçüler için route-seviyesi entegrasyon testi eklenmedi;
  parse/sıralama/validation unit testleriyle (`tests/unit/bulk-product-import.test.ts`) ve typecheck ile
  kapsandı.

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
