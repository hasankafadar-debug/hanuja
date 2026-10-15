# Sipariş fatura yönetimi

Son güncelleme: 2026-10-14 — satıcı Hanuja modeli ve ayrı iade faturası.

Sipariş ve iade sürecinde üç ayrı fatura vardır:

| Fatura | Kesen → alan | Kayıt | Kim görür |
|---|---|---|---|
| Satış faturası (e-Arşiv) | Hanuja → müşteri | `OrderCustomerInvoice` | Müşteri ("Faturalarım", sipariş detayı), admin |
| Alış faturası | Satıcı (tasarımcı) → Hanuja | `OrderSellerInvoice` | Satıcı, admin. **Müşteriye hiçbir yoldan gösterilmez.** |
| İade faturası | Hanuja → ilgili tasarımcı | `SellerReturnInvoice` | Yalnız ilgili tasarımcı ve admin |

Müşteri bağlantıları `NEXT_PUBLIC_WEB_URL` üzerinden oluşturulur:
`/api/orders/{id}/documents/customer-invoice` (sahiplik kontrollü). Eski
`/documents/invoices/{sellerId}` bağlantıları (müşteri, satıcı ve admin sitelerinde) bu route'a
307/no-store yönlendirilir; satıcının dosyası okunmaz.

## Satıcının Hanuja'ya faturası

- Tutar: KDV dahil satış − satıcı kupon payı − KDV dahil komisyon; ürünün KDV oranıyla
  (`api/domain/seller-purchase-invoice.ts`). İptal edilen adetler düşer, komisyon muafiyeti uygulanır,
  kargo faturada yer almaz. Satıcı dökümü sipariş detayında görür.
- Satıcı faturayı ürünü kargoya verirken keser; açıklamasına sipariş numarasını yazar. Alıcı bilgisi
  Hanuja'nın unvanı, adresi, vergi dairesi/VKN ve MERSİS'idir (`PLATFORM_LEGAL_INFO`).
- Fatura yalnız panelden yüklenir. E-postadan otomatik belge alma kaldırılmıştır.
  Her yeni dosya incelemeyi sıfırlar (`reviewStatus = pending`, fatura no/tarih boşalır).
- Kargo girişi fatura olmadan da yapılır. Kargoya verilişten 1 saat sonra fatura yoksa satıcıya tek
  seferlik hatırlatma gider (`seller_invoice_reminder`, `seller-invoice-reminder` işi). Ceza yoktur.
- **Admin onayı:** tutar, KDV oranı ve sipariş numarası kontrol edilir; fatura no ve fatura tarihi
  girilerek onaylanır (tarih ileri olamaz, ödeme tarihinden önce olamaz). Onay hakediş vadesini yazar:
  fatura tarihi + 30 gün sonrasındaki ilk cuma (`docs/01-business/payout-policy.md` §3). Red gerekçe
  ister (5–1000 karakter) ve satıcıya `seller_invoice_rejected` bildirimi gider. İkisi de `If-Match`
  ister ve denetim kaydı yazar (`seller_invoice_approved` / `seller_invoice_rejected`).
- Onaylı fatura yeniden değerlendirilemez; satıcı onaylı faturayı değiştiremez/silemez, gelen e-posta da
  onu değiştiremez (`blocked_invoice_policy`). Düzeltme gerekirse admin dosyayı kaldırıp yeniden yükler.
- Satıcı faturası müşteriye bildirim üretmez.

## Hanuja'nın müşteri faturası

- Hanuja satış faturasını kargoya verilişten itibaren 7 gün içinde keser (VUK 231/5). İlk aşamada
  Uyumsoft'ta manuel kesilir; admin sipariş detayındaki "Müşteri faturası (Hanuja)" kartından PDF'i
  yükler. Satıcı faturasını beklemez.
- Admin sipariş detayındaki "e-Arşiv için bilgiler" bloğu faturada gerekenleri toplar: alıcı kimliği ve
  fatura adresi, satırlar ve KDV oranları, ödeme yöntemi/tarihi, kargo firması ve kargoya veriliş tarihi,
  satışın internet üzerinden yapıldığı bilgisi. Tutarlar, kupon/havale indirimleri ve kargo ücreti sipariş
  özetindedir.
- Yükleme, değiştirme (sürüm + gerekçe) ve kaldırma (gerekçe) denetlenir
  (`customer_invoice_uploaded` / `_replaced` / `_removed`). Her yeni dosya müşteriye bir kez
  "Faturanız oluşturuldu" bildirimi üretir (olay anahtarı `customer-invoice:{orderId}:{revision}`).
  Gönderimden önce dosyanın hâlâ güncel ve müşteriye ait olduğu yeniden kontrol edilir.
- Admin sipariş listesi: fatura sütunu, "Müşteri faturası bekleyen" (kargoya verilmiş, faturasız; son gün
  kargoya veriliş + 7 gün) ve "Müşteri faturası kesilmiş" hızlı filtreleri.

## İşlem kuralları

- Satıcı ilk yüklemeden itibaren 30 × 24 saat içinde silebilir/değiştirebilir.
  `OrderSellerInvoicePolicy.firstUploadedAt` silme, değiştirme veya yeniden
  yüklemeyle sıfırlanmaz. Süre dolunca API de işlemi reddeder.
- Admin süresiz silebilir, ilgili sipariş satıcısı adına yükleyebilir/değiştirebilir.
- Silme ve değiştirme mevcut dosya sürümünü `If-Match` ile taşır. Eksik sürüm 428,
  eski sürüm 412, satıcının dolmuş süresi 403 döndürür. Gerekçe 5–1000 karakterdir.
- Kaldırma siparişe eklenen belgeye uygulanır; muhasebe/e-fatura iptali değildir.
  Kaldırmada e-posta gönderilmez. Satıcı faturası yüklemesi müşteriye bildirim üretmez; müşteri
  bildirimi yalnız Hanuja'nın müşteri faturası yüklendiğinde oluşur.
- Audit kayıtları kalıcıdır. Gelen e-posta olayları korunur; tekrar teslim edilen
  olay kaldırılmış faturayı canlandırmaz. Süresi kapanmış yeni olay terminal
  `blocked_invoice_policy` olur. Otomasyonun açılması ayrı operasyon kararıdır.

## Şema ve dosya temizliği

Migration `20261007190000_order_invoice_management` eklemelidir. Satıcı Hanuja modeli
`20261011120000_seller_purchase_invoice_customer_invoice` ile inceleme alanlarını, `order_customer_invoices`
tablosunu ve bildirim/denetim enum değerlerini ekler (yalnız ekleme; mevcut faturalar `pending`).
Müşteri faturası dosyaları da aynı özel depoda tutulur; temizlik aktif referans kontrolü iki tabloyu da okur. Mevcut faturaların
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
