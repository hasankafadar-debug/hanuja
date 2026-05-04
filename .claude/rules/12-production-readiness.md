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
