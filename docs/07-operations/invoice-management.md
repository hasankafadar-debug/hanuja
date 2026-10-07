# Sipariş fatura yönetimi

Müşteri bağlantıları `NEXT_PUBLIC_WEB_URL` üzerinden oluşturulur. Satıcı/admin
sitelerindeki eski müşteri fatura bağlantıları müşteri sitesine 307/no-store
yönlendirilir; oturum ve sipariş sahipliği hedef uygulamada doğrulanır.

## İşlem kuralları

- Satıcı ilk yüklemeden itibaren 30 × 24 saat içinde silebilir/değiştirebilir.
  `OrderSellerInvoicePolicy.firstUploadedAt` silme, değiştirme veya yeniden
  yüklemeyle sıfırlanmaz. Süre dolunca API de işlemi reddeder.
- Admin süresiz silebilir, ilgili sipariş satıcısı adına yükleyebilir/değiştirebilir.
- Silme ve değiştirme mevcut dosya sürümünü `If-Match` ile taşır. Eksik sürüm 428,
  eski sürüm 412, satıcının dolmuş süresi 403 döndürür. Gerekçe 5–1000 karakterdir.
- Kaldırma siparişe eklenen belgeye uygulanır; muhasebe/e-fatura iptali değildir.
  Kaldırmada e-posta gönderilmez; yeni doğru yüklemede mevcut bildirim oluşur.
- Audit kayıtları kalıcıdır. Gelen e-posta olayları korunur; tekrar teslim edilen
  olay kaldırılmış faturayı canlandırmaz. Süresi kapanmış yeni olay terminal
  `blocked_invoice_policy` olur. Otomasyonun açılması ayrı operasyon kararıdır.

## Şema ve dosya temizliği

Migration `20261007190000_order_invoice_management` eklemelidir. Mevcut faturaların
ilk zamanı `createdAt` ile doldurulur; replacement tarihini taşıyan `uploadedAt`
kullanılmaz. Yeni policy ve cleanup tabloları vardır; aktif invoice satırı silinir.

Invoice değişikliği, audit ve `PrivateDocumentCleanup` niyeti aynı transaction'da
kaydedilir. Dosya temizliği hemen denenir; worker her 5 dakikada due kayıtları
tarar. Hatalar 5 dakika–1 saat aralığında yeniden denenir; 8 ve üzeri denemede
`[private-document-cleanup][operational-alert]` üretilir. Aktif fatura referansı
bulunan dosya korunur. Kayıp COMMIT yanıtından sonraki cleanup da bu kontrolü kullanır.

Worker, UID 1001 ile `/var/lib/hanuja/private-documents` host dizinini aynı hedefe
read/write bağlamalıdır. `PRIVATE_DOCUMENT_ROOT` aynı mutlak dizindir. Delete-only
yardımcı şifre çözme anahtarı istemez; key/dizin/symlink sınırını doğrular. Mevcut
yedek kopyaları mevcut saklama süresine tabidir.

## Yayın ve geri dönüş

1. İlgili testleri, API/app tip kontrollerini, üç Next üretim build'ini ve worker
   Docker build'ini tamamlayın. Yerel PostgreSQL testi yalnız disposable
   `hanuja_notification_test` veritabanında ayrı şema kullanır.
2. Dört serviste `NEXT_PUBLIC_WEB_URL=https://www.hanuja.com.tr` değerini doğrulayın.
   Yeni yönetim işlemlerinin rollout sırasında kapalı kalması için
   `INVOICE_MANAGEMENT_ENABLED=false` kullanın; boş değer de kapalıdır.
3. Worker volume/root yapılandırmasını kalıcı Coolify ayarına ekleyin. Görev
   dosyalarını commit/push edin. Runbook sırası: worker + migration gate → admin →
   satıcı → web. Migration/worker başlangıcı başarılı olmadan panellere geçmeyin.
4. Dört servis fatura değişikliklerini içeren sürümlerde ve sağlıklıyken yalnız admin ve satıcı runtime'ında
   `INVOICE_MANAGEMENT_ENABLED=true` etkinleştirin; yeni runtime'ı başlatın.
   Yalnız müşteri uygulamasına ait takip düzeltmeleri storefront-only runbook
   kuralıyla web'e yayımlanır; ortak fatura API/şema sürümü değişmez.
5. Test siparişinde eski e-posta linkini, test belgesinin silinmesini, audit ve
   aktif dosya cleanup'ını, admin yeniden yüklemesini ve müşteri erişimini doğrulayın.
   Yayın sonrası en az 15 dakika servis hata/restart kayıtlarını izleyin.

Sorunda yönetim flag'ini kapatın; yeni policy/cleanup tablolarını ve audit'i koruyun.
Kod geri dönüşü ilk yükleme sınırını eski yazıcılarda uygulamaz; invoice mutasyonları
doğrulanmadan eski sürümle tekrar açılmamalıdır. İşlenmemiş cleanup niyetleri yeni
worker yeniden başladığında kaldığı yerden devam eder.
