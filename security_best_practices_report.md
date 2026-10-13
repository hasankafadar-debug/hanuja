# Kategori genişletmesi güvenlik incelemesi

13 Ekim 2026. Commit ve push öncesinde `security-best-practices` skill'iyle incelendi.

Kategori yönetimi, tekli/toplu ürün oluşturma, şablon sürümleri, kategori değişikliği, özellik filtreleri, stok işlemleri ve arama projeksiyonu incelendi. Bu değişikliklerde tespit edilen sorunlar giderildi. Deponun tamamı açık içermiyor denemez: son `pnpm audit --json` sonucu **3 kritik, 25 yüksek, 36 orta ve 4 düşük** bağımlılık uyarısı içeriyor. Bu sayılar erişilebilir uygulama açığı sayısı değildir; aşağıdaki erişim koşulları ayrı değerlendirilmiştir. Üretime karşı saldırı testi yapılmadı.

## Giderilen bulgular

1. **Yüksek — kullanıcı dosyasını ayrıştıran eski SheetJS.** Tasarımcı ve admin panelinde `xlsx@0.18.5`, bilinen prototype pollution ve ReDoS uyarılarını taşıyordu. İki panel de resmî CDN'deki **0.20.3** paketine geçirildi. Kaynak: `apps/seller-panel/package.json:29`, `apps/admin-panel/package.json:29`; son taramada `xlsx` uyarısı kalmadı. [Resmî kurulum](https://docs.sheetjs.com/docs/getting-started/installation/nodejs/), [prototype pollution](https://github.com/advisories/GHSA-4r6h-8v6p-xvw6), [ReDoS](https://github.com/advisories/GHSA-5pgg-2g8v-p4x9).

2. **Kritik/yüksek bağımlılık uyarıları — görüntü işleme ve Next.js.** Next.js **15.5.27**, Sharp **0.35.5**, Undici **7.29.1** olarak sabitlendi. Mevcut React render düzeltmesi yeni Next sürümüne taşındı ve 15 regresyon testi geçti. Kaynak: `package.json:60`, `package.json:71`, `api/package.json:21`, `patches/next@15.5.27.patch`. Depoda bir RCE saldırısı gösterilmedi; güncelleme bildirilen savunmasız sürümleri kaldırır. [Next AVIF uyarısı](https://github.com/advisories/GHSA-2xp9-vwfh-vxw4), [Sharp uyarısı](https://github.com/advisories/GHSA-wq5f-xc86-pv6w).

3. **Orta — özel filtre anahtarının kalıtılmış nesne üyelerine erişmesi.** `f.constructor` gibi girdiler normal nesnedeki kalıtılmış üyeyi filtre gibi ele alıp hata oluşturabiliyordu. Filtre sözlüğü prototipsiz nesneye geçirildi. Kaynak: `api/domain/property-filters.ts:33`, doğrulama: `tests/security/category-property-filters.test.ts`. Bu bulgu için keyfi kod çalıştırma veya prototip kirletme kanıtı yoktur.

4. **İşlevsel güvenlik uyumu — admin istemcisinin CSRF başlığını taşımaması.** Yeni yönetim ekranındaki istekler `csrfFetch` kullanıyor. Sunucudaki token, session ve admin rolü denetimleri korunuyor. Kaynak: `apps/admin-panel/src/app/(panel)/kategoriler/_components/catalog-management.tsx:27`, `apps/admin-panel/src/app/api/admin/catalog-schema/route.ts:76`. `CSRF_STRICT=true` ile gerçek panelde kategori oluşturuldu; tokensız mutasyon 403 döndü. Bu, sunucuda gösterilmiş bir CSRF atlatması değildir.

5. **Savunma güçlendirmesi — özel yerel dosyaların Docker bağlamına girmesi.** `.env.*`, `.tmp`, `.agents`, `.codex`, tarayıcı izleri ve çıktı klasörleri dışlandı. Kaynak: `.dockerignore:14`. Gerçek anahtar sızıntısı tespit edildiği iddia edilmiyor.

## Kalan kritik uyarılar: test ortamı

6. **Kritik — Vitest 1.6.1 UI sunucusu.** UI sunucusu erişime açıldığında dosya okuma/çalıştırma riski vardır. `tests/package.json:23` eski majör sürümü kullanır. Bu görevde `vitest run` çalıştırıldı; UI sunucusu açılmadı. `tests` Docker bağlamından dışlanır (`.dockerignore:31`). Vitest ve coverage paketlerinin birlikte uyumlu sürümlere geçişi ayrı regresyon çalışması gerektirir. [Vitest uyarısı](https://github.com/advisories/GHSA-5xrq-8626-4rwp).

7. **Kritik — Tinypool 0.8.4 için iki gadget uyarısı.** Prototip kirletme önkoşulu sağlandığında worker seçenekleri üzerinden kod çalıştırma riski vardır. Kilit dosyasında yalnız `tests → vitest → tinypool` yollarında bulunur; üretim kategori akışında bu test havuzu kullanılmaz. Test araçlarının birlikte güncellenmesi gerekir. [Worker seçenekleri](https://github.com/advisories/GHSA-5gmw-xhrv-c9v3), [run seçenekleri](https://github.com/advisories/GHSA-85c8-ppgw-ccpr).

## Kalan yüksek uyarılar: öncelikli takip

8. **Yüksek — Nodemailer 6.10.1 çalışma zamanı bağımlılığı.** Adres ayrıştırıcısında DoS, raw içerik seçeneğinde dosya/URL erişimi ve OAuth2 TLS uyarıları vardır. Kaynak: `api/package.json:20`, `api/lib/mailer.ts:103`, `api/lib/mailer.ts:131`. Mevcut mailer yalnız seçili alanları iletir; `raw`, kullanıcı tanımlı transport, `envelope.size` veya OAuth2 yapılandırmasını kabul etmez. Bu koşullar bazı uyarıların doğrudan erişimini daraltır; adres ayrıştırma riskini bütünüyle kaldırmaz. SMTP gönderimi ve alıcı doğrulaması ayrı kapsamda güncellenmelidir. [Raw uyarısı](https://github.com/advisories/GHSA-p6gq-j5cr-w38f).

9. **Yüksek — yapılandırma ve derleme bağımlılıkları.** Audit ayrıca Vite, js-yaml, nanoid, deepmerge-ts, browserslist, mysql2, fast-uri, brace-expansion, braces ve source-map-js uyarıları bildirir. Vite test araçları üzerinden; mysql2/fast-uri/deepmerge-ts Prisma geliştirme/CLI zincirleri üzerinden gelir. Uygulama PostgreSQL kullanır. ExcelJS arşivleme zincirindeki brace-expansion uyarıları da raporda kalır; yeni şablon üretimi sunucunun oluşturduğu veriyle çalışır. Bu sınıflandırma her transitif paketin tüm kullanım yollarının sömürülemez olduğunu kanıtlamaz. Kalan bağımlılık borcu için ayrı kapsamlı güncelleme ve regresyon çalışması gerekir.

## Denetlenen sınırlar ve kanıtlar

- Yeni admin uçları session ve `admin` rolü denetler (`apps/admin-panel/src/app/api/admin/categories/route.ts:20`); mutasyonlar `checkCsrf` çağırır (`:39`). Anonim GET 401, tokensız POST 403 doğrulandı.
- Tasarımcı uçları session'dan satıcı sahipliğini çözer; genel API mutasyonlarında panel middleware Origin sınırı uygulanır. Kaynak: `apps/seller-panel/src/app/api/seller/products/bulk/route.ts:250`, `apps/seller-panel/src/middleware.ts:128`. Yerelde son toplu yükleme tekrarı `CSRF_STRICT=true` altında yapıldı.
- SQL kilitleri Prisma parametre bağlama kullanır; kullanıcı girdisi ham SQL metnine eklenmez. Kaynak: `api/domain/product-stock.ts:11`, `api/services/catalog-admin.service.ts:50`.
- Kategori değiştirmede kaldırılacak veri ve mevcut şema/sürüm onay özetiyle bağlanır; sunucu önizlemesiz veri kaybını reddeder. Bu token yetkilendirme yerine geçmez. Kaynak: `api/services/category-schema.service.ts:242`, admin mutasyonunda ayrıca rol denetimi.
- Gizlenen alan değerleri silinmez, kullanılan seçenekler pasifleştirilir. İlk yayın kilidi DB tetikleyicisindedir; eski unlisted ürünün yeniden yayını tarihsel kanıtı kullanır.
- Gerçek PostgreSQL'de 7 test: son stoğa iki eşzamanlı checkout, iki eşzamanlı iptalde tek iade, birim değiştirme yarışı, immutable yayın tarihi, barkod çakışması ve dirty revision koruması dahil. Meilisearch 1.49.0'da 8 sözleşme kontrolü geçti.
- Yerel gerçek panel testleri: ana/alt kategori ekleme, tekli ve toplu yükleme, admin onayı, gizli dalın yayınla görünmesi, stoklu beden+renk eşleşmesi, stoksuz varyantın elenmesi, şablondan çıkarılan alanın geri gelmesi, eski Excel'in reddedilmesi.
- Ana test koşusu 2876 başarılı, 2 atlandı; son bağımlılık güncellemelerinden sonra ilgili 58 test tekrar geçti. Panel derlemeleri, tip kontrolü ve lint yayın kapısının parçasıdır.

Bu rapor görev kapsamındaki inceleme ve ölçümlerin kaydıdır; bütün depo veya üretim için sızma testi sertifikası değildir. Ham audit çıktısı ve test erişim bilgileri commit edilmez.
