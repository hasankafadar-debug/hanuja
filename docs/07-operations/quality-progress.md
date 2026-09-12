# Hanuja kalite ve performans — devam notu

Son güncelleme: 2026-09-12. Başlangıç commit'i: `6361cc7`.

## Çalışma düzeni ve kararlar

- Yönetici ajan sorunu araştırır, kanıtı değerlendirir ve uygulanacak çözümü tarif eder.
- Kodlamayı yalnız GPT-5.6 Sol yapar. Sol çalışırken yönetici bekler; paralel araştırma veya ikinci iş başlatılmaz. Yönetici sonucu inceler ve doğrular; gerekirse düzeltmeyi yeniden Sol'a verir.
- Her tamamlanan işte bu not ve konuşmadaki kısa özet güncellenir. Yeni oturumda önce bu dosya okunur.
- Kapsam tam ürün denetimidir; ilk öncelik admin Satıcılar → İncele geçişidir.
- Tasarım kimliği, canlı kayıtlar, İyzico entegrasyonu ve ürünsüz kategorilerin gizlenmesi korunur. Yeni kart sağlayıcısı ve gerçek tahsilata geçiş kapsam dışıdır; mevcut ödeme hazırlığı ve testleri kapsamdadır.
- Sunucu: 8 vCPU, 16 GB RAM, 120 GB SSD. Kullanıcı trafik olmadığını ve bir gerçek satıcı olduğunu belirtti. İlk yük testi varsayımı 50 satıcı / 5.000 üründür; yalnız izole test ortamında.
- Finansal testler ayrı test veritabanında; canlıda salt okunur kontroller. Görev dışı `.agents/` ve `outputs/` değişiklikleri commit edilmez.
- Kabul edilen değişiklikler ilgili test/lint/typecheck/build sonrasında görev dosyalarıyla commit/push edilir; etkilenen Coolify servisleri production runbook'a göre dağıtılır ve canlıda doğrulanır.

## Doğrulanan bulgular

1. Canlı mevcut Chrome oturumunda Satıcılar listesindeki İncele bağlantısına bir kez basıldı; bir dakikadan fazla süre liste değişmedi, yüklenme göstergesi çıkmadı. Yakalanan console error/warn kayıtları boştu. Aynı detay adresi doğrudan açıldığında detay başlığı göründü ve yüklenme tamamlandı. Kesin ağ/RSC kök nedeni henüz ölçülmedi.
2. `apps/admin-panel/src/app/(panel)/saticilar/[id]/page.tsx` temel profil yanında finans, belgeler ve ekstre sorgularını ilk render öncesi bekliyor.
3. Admin middleware iç HTTP çağrısıyla oturumu doğruluyor; layout ve sayfa da `getAdminSession` çağırıyor. Yardımcıda React istek memoizasyonu yok; ancak Better Auth'un beş dakikalık cookie cache'i var. Her çağrı DB sorgusudur diye varsayılmamalı.
4. `packages/ui/src/components/composite/sidebar-nav.tsx` doğal anchor kullanıyor; yan menü tam belge gezinmesi yapıyor.
5. `api/services/catalog.service.ts` içindeki `loadPublishedCandidates` ürün take/skip sınırı koymuyor; `listPublishedCurated` tüm adayları zenginleştirip sıraladıktan sonra slice uyguluyor. Ana sayfada da tam aday taramaları var. Düzenleme sıralama ve indirim sonuçlarını korumalı.
6. `api/worker.ts` worker'ları başlatıyor ancak `scheduleRepeatableJobs` çağırmıyor. Dockerfile'ın kullandığı `api/jobs/worker-entrypoint.ts` zamanlanmış işleri kuruyor.
7. Birim, entegrasyon ve Playwright testleri ile CI test veritabanı tanımlı. Gerçek Coolify kaynak kullanımı ve canlı kurulumun config uyumu henüz ölçülmedi.

## Sıra ve kabul

1. İncele kök nedenini ölç; Sol'a sınırlı çözüm paketi ver; incele/test et/dağıt/doğrula.
2. Panel gezinme ve veri yükleme iyileştirmeleri.
3. Katalog ölçeklenmesi, sorgular ve worker tutarlılığı.
4. Mağaza, satıcı, admin, sipariş/EFT/mevcut kart testi/iptal/iade/hakediş, bildirim, belge erişimi ve teknik SEO denetimi.
5. Kaynak, yedek, geri dönüş ve izole kapasite testleri; önce/sonra raporu.

- İncele: 20 tekrarın tamamında tek tıklama; gecikmede 200 ms içinde görünür geri bildirim; normal bağlantıda sıcak panel geçişlerinde hedef p95 ≤ 2 saniye.
- Finans sonuçları ve katalog sıralaması korunmalı; ödeme/iade tekrarları çift işlem üretmemeli.

## Şu anki durum

- İlk admin gezinme paketi Sol tarafından kodlandı; yönetici incelemesi ve doğrulaması sürüyor. Henüz commit/push/deploy yapılmadı.
- 2026-09-12 ölçümünde semantik tek İncele tıklaması yaklaşık 3,1 saniyede detayı gösterdi (tarayıcı otomasyonunun tıklama/bekleme süresi dahil; ağ TTFB ölçümü değildir). Belirti aralıklı.
- Üretim SSH erişimi: bilinen host `77.245.158.7`, port `22666`, mevcut yerel `hanuja_prod_ed25519` anahtarı. Varsayılan port 22 zaman aşımına uğruyor. Anahtar içeriği belgeye yazılmaz.
- Sunucu salt okunur ölçümü: load 0.55/0.71/0.78; kullanılabilir RAM 11.903 MB; disk %35; admin/web/seller restart sayısı 0. O anda kaynak doygunluğu kanıtı yok.
- PostgreSQL: 51 idle + 1 aktif bağlantı, max_connections 100 (tek anlık görüntü). Bağlantı bütçesi ileride yük testinde değerlendirilecek.
- Canlı admin/worker `6361cc7`; web/seller `a346657`. Servislerin aynı commit'te olduğu varsayılmamalı.
- Admin Playwright satıcı detay testi İncele yerine satıcı adı içeren link arıyor; görünmezse sessizce test gövdesini atlıyor. Gerçek bağlantıyla koşulsuz doğrulama gerekiyor.
- Önceki Luna araştırması kullanıcı isteğiyle durduruldu; tamamlanmış raporu yok.
- Sıradaki adım: ilk paketin build ve ilgili finans kontrolleri, ardından admin deploy ve canlı tekrar ölçümü.

## Admin satıcı gezinme paketi — inceleme bekliyor

- Satıcı listesindeki `İncele` ve detay sayfasındaki `Satıcılara Dön` bağlantıları, Next.js
  `useLinkStatus` ile çalışan ortak `PendingLink` bileşenine geçirildi. Bağlantı normal davranışını
  koruyor; 100 ms süren gezinmelerde görünür spinner ve `Yükleniyor` durum metni gösteriyor.
- `(panel)/loading.tsx` eklendi. Panel kabuğu ve yan menü yerinde kalırken içerik alanında
  erişilebilir bir iskelet gösteriliyor.
- `getAdminSession`, React `cache` ile aynı sunucu isteği içindeki tekrarlı çağrılar için memoize
  edildi. Middleware, rol kontrolü ve Better Auth cookie cache ayarları değiştirilmedi.
- Satıcı hesap ekstresi sorgusu temel detay `Promise.all` grubundan çıkarılıp kendi async server
  bölümünde `Suspense` ile akıtıldı. Tarih aralığı, Excel export adresi ve mevcut hesap ekstresi
  çıktısı korundu.
- Admin finans E2E testi artık ilk gerçek satıcı satırındaki `İncele` bağlantısını zorunlu olarak
  doğruluyor; tek tıklamadan sonra seçilen satıcının başlığını, detay URL'sini, `Toplam Sipariş` ve
  `Bekleyen Hakediş` içeriğini bekliyor. Odaklı gezinme testi route'u liste açılmadan kuruyor,
  prefetch dahil gerçek detay RSC isteğini kaydedip Promise kapısında tutuyor, sabit `href`
  locator'ında erişilebilir pending durumunu doğruluyor ve kapıyı `finally` içinde serbest bırakıyor.
  Geri dönüş ve ikinci gezinme de doğrulanıyor; zamanlamaya bağlı panel loading assertion'ı çıkarıldı.
- `pnpm --filter admin-panel typecheck`: geçti.
- `pnpm --filter admin-panel lint`: geçti; değiştirilen dosyalarda hata/uyarı yok, depo içinde bu
  paket öncesinden kalan dokuz uyarı raporlandı.
- `pnpm exec playwright test --config=tests/e2e/playwright.config.ts --project=admin-panel
  tests/e2e/admin-panel/admin-finance.e2e.ts --list --reporter=line`: geçti, 18 test keşfedildi.
- İzole fixture eklendi. Guard yalnız `localhost`, `127.0.0.1` veya IPv6 loopback üzerinde adı tam
  olarak `hanuja_navigation_test` olan PostgreSQL URL'sini kabul ediyor; eksik URL, geliştirme DB'si
  ve uzak host yazmadan hata veriyor. Fixture yalnız test admin hesabını, onun credential kaydını,
  tek sentetik satıcı User/Seller/Profile zincirini ve platform ayarını idempotent upsert ediyor;
  `deleteMany`, sipariş, ödeme ve e-posta işlemi yok.
- `pnpm --dir tests exec vitest run unit/admin-navigation-database-guard.test.ts`: geçti, 5/5.
- İzole PostgreSQL/Redis altyapısı yönetici tarafından hazırlandı. Talimat gereği fixture, E2E ve
  build bu düzeltme turunda çalıştırılmadı; bu kontroller geçmiş sayılmadı.
- Kesin ağ/RSC kök nedeni halen kanıtlanmış değil. Bu paket görünür ilerleme geri bildirimi sağlar
  ve ekstre bekleme süresini temel detay yanıtından ayırır; aralıklı gezinme sorununun bütünüyle
  çözüldüğü iddia edilmez.
- Yönetici incelemesi öncesi commit, push ve deploy yapılmadı.

## Yönetici doğrulaması — 2026-09-12

- Gerçek Playwright tarayıcı koşusu: iki odaklı `seller detail` testi geçti (15,2 sn toplam).
  Tek tık, doğru satıcı başlığı/finans özeti, bloke edilmiş RSC sırasında pending durumu ve
  geri dönüp yeniden açma doğrulandı. Geliştirme sunucusu ölçümü canlı hız sonucu değildir.
- İlk yerel koşularda test captcha anahtarı ile sahte token uyumsuzluğu düzeltildi; uygulama
  kodu ve canlı captcha ayarları değiştirilmedi. Ardından ilk sayfa derlemeleri assertion
  sürelerini aştı; derlenmiş sayfalardaki son koşu yeniden deneme olmadan geçti.
- Oturum arasındaki yerel süreç/izole container kaybı nedeniyle test altyapısı yeniden kuruldu.
  PostgreSQL yalnız `127.0.0.1:15432/hanuja_navigation_test`, Redis yalnız `127.0.0.1:16379`.
  65 migration ve sentetik fixture başarıyla uygulandı. Gerçek `hanuja_dev` DB'sine yazılmadı.
- Geçici yerel sunucu başlatıcısı `%TEMP%/hanuja-quality/admin-dev.ps1`; günlükler aynı dizinde.
  Test sonrası bu işe ait sunucu süreci kapatıldı; üretim build'i başlatıldı.
- Coolify'da dört uygulama da `codex/release-2026-07-15`, commit seçimi `HEAD`.
  İlk paket yalnız admin uygulamasını etkiler; migration ve worker değişikliği yok.
- Kodlama ajanı bu oturumda aktif değil. Sonraki uygulama değişikliği gerekirse yalnız bir
  GPT-5.6 Sol görevi başlatılacak; yönetici o sırada bekleyecek.
- Üretim build'i geçti (Next.js 15.5.22; aynı dokuz önceden mevcut lint uyarısı).
  Oturum politikası, fixture guard ve ekstre/Excel export kontrolleri 15/15 geçti.
- Dağıtım öncesi canlı eski sürümde tek semantik tıklama yeniden listeyi değiştirmedi.
  Sonraki kontrollerde de detay açılmadı; console hata/uyarı kaydı yok. Bağlantı 46×16 px ve
  merkezinde onu örten DOM katmanı yok. Kesin RSC/ağ nedeni hâlâ ölçülmüş değil.
- Admin paketi commit/push/deploy için kabul edildi; canlı tekrar doğrulaması henüz yapılmadı.
