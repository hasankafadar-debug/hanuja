# Kategori genişletmesi yayın ve doğrulama planı

13 Ekim 2026. Kaynak: kökteki `kategori-plani-ek.md` sürüm 3 ve kullanıcı tarafından kabul edilen düzeltmeler.

## Uygulanan sözleşme

- Ev/Ofis korunur; Excel ve Ek B'deki 337 yeni düğüm, 50 şablon ve 114 alan eklenir. 280 yeni yaprağın zorunlu alanları snapshot ile doğrulanır.
- BEB-BEZ: Paket Adedi ürünün ortak zorunlu özelliğidir; Bez Numarası varyant alanıdır. Farklı paket adetleri ayrı üründür.
- Renk ve materyal ürün düzeyindedir. Eski dolu varyant renk/materyal kolonları sessizce atılmaz; hata ile reddedilir. Mevcut eski değerler düzenleme sırasında korunur.
- Sayılar tek kanonik birimde saklanır; TB dönüşümü 1000 GB'dır. Sayısal filtre en fazla 12 gerçek değeri liste olarak, sonrasında aralık olarak gösterir.
- Bir üründe tek temel varyant alanı değişebilir. Arama projeksiyonu ürün başına bir belge ve yalnız stoklu temel varyant değerlerini içerir. Meilisearch 1.49.0'da çoklu sayısal değerlerin tek TO aralığında eşleşmesi gerçek servis testiyle doğrulanır; facet sayısı ürün sayısıdır.
- İlk yayın tarihi veritabanı tetikleyicisiyle korunur. Kanıtı olmayan unlisted kayıtlar kilitlenir; kanıtı olmayan draft/pending_review/rejected kayıtları kilitlenmez. Sipariş geçmişi ayrıca kategori değişikliğini engeller.
- Şablon değişikliği değerleri silmez. Pasif seçenek mevcut üründe korunur. Kategori değişikliği gerçekten kaldırılacak özellik, varyant, renk, materyal ve ölçüleri onay token'ına bağlar.
- Şablon bazlı uyumluluk sürümü kullanılır. Metadata'sız eski Ev/Ofis şablonları yalnız ilgili sürüm 1 olduğu sürece kabul edilir.
- Sözleşme v6 yeni siparişlerde gerçek seçili varyant özelliklerini saklar; geçmiş v5 sipariş belgeleri korunur.
- Stok düşümü ve iadesi ürün/varyant toplamını aynı kilitli transaction içinde değiştirir. Eşzamanlı son stok ve tekrar iptal gerçek PostgreSQL ile sınanır.
- Kalıcı dirty kayıtları stok, ürün, kategori ve satıcı değişimlerini kapsar. İndeks görevleri son DB halini okur; yalnız işlediği revision'ı onaylar. Kuyruk kesilirse tekrar işleme kaydı DB'de kalır.

## Yayın sırası

1. Yerel admin, tasarımcı tekli/toplu yükleme ve mağaza kategori/arama testleri tamamlanır. Güvenlik taraması, lint, tip kontrolü, testler ve üç panel derlemesi geçer.
2. Yalnız görev dosyaları commit edilir; `codex/release-2026-07-15` dalı push edilir. Dört Coolify servisinin dalı ve Commit SHA=HEAD ayarı doğrulanır.
3. Üretim DB yedeği ve servis bazlı `check-env --env=prod` kontrolleri doğrulanır. Meilisearch'in 1.49.0 olduğu kontrol edilir; mevcut volume silinmez.
4. Worker deploy edilir. Başlangıç zinciri: Prisma migration → idempotent katalog kurulumu → yayın/stoğun dry-run raporu ve bir defalık backfill → geçici indeks oluşturma ve atomik swap → bekleyen dirty revision'ları işleme → normal worker.
5. Worker başarılı olmadan ilerlenmez. Ardından admin → seller-panel → web sırasıyla deploy edilir.
6. Her servisin container commit'i ve health sonucu okunur. Mağaza görünür kategori ağacı, kategori/arama sonucu ve yeni yönetim rotaları canlıda kontrol edilir.

Dry-run dosyaları worker `/app/.tmp/category-expansion` dizinindedir ve herkese açık değildir. Yeniden başlatmalarda DB'deki kurulum marker'ları veri yazma ve ilk indeks kurulumunu tekrar etmez. Dirty relay normal çalışmada devam eder.

## Geri dönüş

Migration'lar eklemelidir. Uygulama rollback'i mevcut alan ve değerleri silmez. Meilisearch geçişinde canlı indeks ancak yeni indeks tamamlanınca değişir. Worker başlangıç adımı başarısızsa yeni panel deploy'ları durur. Geri dönerken eski uygulama kodunun yeni kategori ürünlerini desteklemediği dikkate alınır; sorunlu yeni ürünler yayımdan kaldırılır ve veri korunur.

Yayın sonunda web de güncellendikten sonra worker içinde `pnpm exec tsx tools/scripts/backfill-category-publication.ts --apply --reconcile-stock` çalıştırılır. Böylece servisler farklı kod sürümlerindeyken oluşabilecek son stok toplamı sapması ürün kilidi altında yeniden hesaplanır. Yayın tarihleri bu modda değiştirilmez. Ardından dirty arama kayıtlarının boşaldığı doğrulanır.

## Yerel doğrulama sonuçları

- Ana test koşusu: 283 dosyada 2876 başarılı test, 2 atlanan test. Son güvenlik bağımlılığı güncellemeleri sonrasında ilgili 58 test tekrar geçti.
- Gerçek PostgreSQL: temiz 89 migration üzerinden 7 test; eşzamanlı checkout/iptal, yayın kilidi, tarihsel kanıt, barkod, veri koruma ve şema değiştirme yarışı dahil.
- Meilisearch 1.49.0: 8 gerçek sözleşme kontrolü; aralık eşleşmesi, stoklu varyant ve ürün bazlı facet sayıları dahil.
- Üç panelin üretim derlemesi geçti. Son admin Excel güncellemesinden sonra admin yeniden derlendi. 8 paketin tip kontrolü ve 7 paketin lint kontrolü geçti; mevcut lint uyarıları duruyor.
- Gerçek admin paneli: ana, Alt 1 ve Alt 2 oluşturma; `CSRF_STRICT=true` ile yeni kategori oluşturma; özellik/şablon önizlemesi ve değişikliği; yayımlanmış ürünün admin tarafından kategori/beden değişikliği.
- Gerçek tasarımcı paneli: tekli ürün oluşturma, Excel indirme/iki varyantlı ürün yükleme, stok düzenleme. Şablondan çıkarılan özellik saklandı, geri eklendiğinde aynı değer görüntülendi. GIY-UST v1 dosyası sürüm 2'de önizlemede reddedildi.
- Gerçek mağaza: admin onayı öncesinde yeni dal gizli, onay sonrasında görünür. Kategori ve aramada M+Mavi eşleşmedi, L+Mavi eşleşti. Stoksuz varyant beden sayımına katılmadı; stok filtresi ve satın alma düğmesi doğrulandı.
- Yerel test ürünleri ve hesapları üretime taşınmaz. Görsel yükleme akışı bu görevin panel test kapsamına dahil edilmedi.
- Güvenlik bulguları ve kalan bağımlılık borcu: kökteki `security_best_practices_report.md`.
