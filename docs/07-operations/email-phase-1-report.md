# E-posta güvenilirliği — Faz 1

## Durum ve canlı teşhis — 22 Eylül 2026

Kullanıcının talimatı: kod, test, commit ve push bu fazda; Coolify ortam değişiklikleri ve
deploy kullanıcı tarafından yapılacak. Deploy ve gerçek gelen kutusu doğrulaması yapılmadan
canlı arıza giderilmiş sayılmaz.

Chrome üzerinden salt okunur incelemede hanuja-worker çalışıyordu. Periyodik kampanya,
teslimat ve IBAN işleri log üretmeye devam ediyordu. Bildirim job'ları sağlayıcıdan
`EENVELOPE`, `550 Invalid from field`, `MAIL FROM` hatası alıyordu. Worker'ın
`EMAIL_FROM_NOREPLY` ayarı adres biçiminde olmayan bir değer içeriyordu; değerin kendisi
bu rapora alınmadı. Bu, incelenen gönderim hatalarının kanıtlanmış nedenidir; bütün eski
bildirimlerin aynı nedenle başarısız olduğu iddia edilmez.

Worker Git Source: `codex/release-2026-07-15`, Commit SHA `HEAD`. Worker, admin, seller ve
web servislerinin Advanced ekranında `Manual deployments only` doğrulandı; push deploy başlatmaz.
Web'de görülen son başarılı deploy commit'i `c38033a` idi. Diğer servislerin son çalışan
commit'lerinin eşit olduğu varsayılmamalıdır.

OTP doğrudan panel sürecindeki SMTP ayarlarını kullanır; işlemsel bildirimler ayrı worker
sürecinde gönderilir. Bu nedenle OTP çalışırken worker gönderen ayarı hatası diğer
e-postaları durdurabilir. Coolify'da hiçbir değer değiştirilmedi ve deploy tetiklenmedi.

## Uygulanan davranış

- Üretimde SMTP eksikliği JSON transport'a düşmez. Gönderen adresleri değerleri loglanmadan
  doğrulanır; seçilen kategorinin hatalı adresi açık bir yapılandırma hatası üretir.
- `enqueueNotification` artık Redis'e doğrudan yazmak yerine PostgreSQL outbox kaydı oluşturur.
  `recordNotification(tx, payload)` aynı iş transaction'ına katılabilen arayüzdür; transaction
  geri alınırsa bildirim de geri alınır. İşlem içinde SMTP/Redis çağrısı yapılmaz.
- Eski olay üreticileri bu çağrıdan itibaren kalıcıdır. Onların işlem sonrası fire-and-forget
  çağrılarını iş transaction'ına taşıma işi, kabul edilmiş plana göre Faz 2 ve sonraki olay
  fazlarında yapılacak. Bu faz tüm sipariş geçişlerini atomik hale getirdiğini iddia etmez.
- `notification-outbox` 15 saniyede bir kalıcı olayları kuyruğa taşır. Redis erişilemiyorsa
  olay veritabanında kalır. Kuyruk yazılıp DB işareti yazılamazsa aynı iş kimliği tekrar
  kullanılır. Tamamlanan/başarısız işlerin durumu uzlaştırılır; başarısız işler kendiliğinden
  sonsuz kez başlatılmaz.
- İşlemsel ve toplu gönderimler ayrı kuyruklarda çalışır. İşlemsel hız saniyede 1,
  toplu hız iki saniyede 1; relay her iki hat için ayrı 50 kayıt seçer. Sağlayıcı hesabının
  günlük/aylık kotası yine ortak kalır; bu ayrım kotayı artırmaz.
- Uygulama içi bildirim, claim ve başarı kaydı tek transaction'da oluşur. E-posta claim'i
  iki dakika süreli ve token ile korunur. Süresi dolan e-posta denemesi belirsiz kabul
  edilir; otomatik yeniden gönderilmez.
- Beş BullMQ denemesi ve üstel bekleme korunur. Olay/alıcı/kanal tekilleştirmesi başarılı
  gönderimi korur. Resend SMTP için ayrıca `Resend-Idempotency-Key` kullanılır; sağlayıcı
  saklama süresinin dışında mutlak tek gönderim garantisi verilmez.
- Merkezi e-posta politikası mevcut desteklenen olayların rol, kategori ve zorunlu verisini
  tanımlar. Desteklenen işlemsel olaylarda eksik alıcı hesabın e-postasından çözülür. Eksik
  veri veya açıkça istenmiş desteklenmeyen e-posta başarısız kayıt olur; boş şablon gönderilmez.
- Müşteri iptal şablonu, iade kararı ve admin olaylarının yeni şablon/tetikleyicileri Faz 2/3'tür.
  Rol doğrulaması mevcut satıcı iptal şablonunun yanlışlıkla müşteriye gönderilmesini engeller.
- Pazarlama gönderimi öncesi izin tekrar kontrol edilir. Üreticinin e-posta alıcısını
  bilerek çıkardığı pazarlama olayları uygulama içi kalır. İzin yoksa durum “gönderilmedi”dir.
- SMTP kabul zamanı, sağlayıcı kimliği ve gerçek teslim olayı ayrılır. Eski e-posta
  `deliveredAt` değerleri migration'da `smtpAcceptedAt` alanına taşınır. Eski kayıtlar da
  otomatik olarak gelen kutusuna teslim sayılmaz.
- Resend webhook'u ham gövde, Svix HMAC imzası ve beş dakikalık zaman penceresiyle doğrulanır;
  64 KiB gövde sınırı vardır. Yinelenen olaylar tekilleştirilir; içerik/alıcı webhook kaydına
  alınmaz. Bounce/şikâyet, daha sonra gelen sent olaylarıyla silinmez.
- Admin `/e-posta` ekranında kayıtlar, başarısız filtre, SMTP/teslim ayrımı ve outbox görünür.
  Tek kayıt yeniden denemesi rol + CSRF + sunucu tarafı durum kontrolü ve gerekçeli audit ile
  yapılır. Başarılı veya sonucu belirsiz gönderim yeniden gönderilemez.
- Eski, payload'ı bulunmayan kayıtlar için yeniden deneme kapalıdır. Teşhis komutu eski
  başarısız BullMQ işlerinin yalnız kimlik/tür/deneme bilgisini önizler. Toplu geçmiş
  gönderimi yapılmadı ve otomatik tekrar gönderim komutu eklenmedi.

## Deploy öncesi kullanıcı adımları

1. Özellikle **hanuja-worker** ortamında `EMAIL_FROM_NOREPLY` değerini
   `Hanuja <noreply@hanuja.com.tr>` olarak düzelt. Dışarıdan ek tırnak veya env değişken adı
   ekleme. `SMTP_FROM` da geçerli bir adres olmalı. Adres Resend'de doğrulanmış domain altında
   olmalı. Fatura/kampanya adreslerini de aynı biçimde kontrol et; boşlarsa SMTP_FROM kullanılır.
2. Dört serviste gerekli SMTP değişkenlerinin runtime'da bulunduğunu kontrol et.
   Worker yeni sürümünde geçersiz üretim SMTP yapılandırması başlangıçta hata verir.
3. Teslim/bounce takibi için Resend'de `https://www.hanuja.com.tr/api/webhooks/resend`
   endpoint'ini tanımla; `email.sent`, `email.delivered`, `email.bounced`, `email.complained`,
   `email.failed`, `email.delivery_delayed` olaylarını seç. İmza anahtarını yalnız web runtime
   ortamına `RESEND_WEBHOOK_SECRET` olarak gir. NEXT_PUBLIC değişkeni oluşturma.
   Bu yapılandırma yapılmazsa gönderim çalışabilir, teslim sonucu “bilgi yok” kalır.
4. Kaynak branch ve HEAD ayarını her serviste kontrol et; deployment sayfasındaki commit'i
   bu fazın push edilmiş commit'iyle karşılaştır.

## Deploy sırası

1. **hanuja-worker** — `20260922000000_notification_reliability` migration'ı mevcut
   Dockerfile startup gate ile uygulanır. Migration exit 0, scheduler ve üç bildirim worker'ı
   doğrulanmadan devam etme. Bu migration ödeme benzersizliği değiştirmez.
2. **hanuja-admin** — e-posta operasyon ekranı ve ortak API üreticileri.
3. **hanuja-seller** — ortak mailer ve bildirim üreticileri.
4. **hanuja-web** — ortak üreticiler ve Resend webhook endpoint'i.

Worker terminalinde `pnpm notification:diagnose` salt okunur kontrolünü çalıştır. Komut
adres/anahtar değerlerini, mesaj gövdelerini veya alıcıları basmaz; kuyruk sayıları ve eski
başarısız iş önizlemesi verir. `pnpm check-env --env=prod --app=worker` da kontrol edilmelidir.

Deploy sonrası test hesabında tek işlemsel olay üret; outbox → SMTP kabulü → varsa sağlayıcı
teslimi → test gelen kutusu zincirini doğrula. OTP'yi ayrıca kontrol et. Gerçek müşterilerin
eski başarısız bildirimlerini topluca yeniden göndermeden önce ayrı liste ve onay gerekir.

## Doğrulama sonuçları

- Faz 1 birim ve API güvenlik testleri: **39/39 geçti**. Gönderen yapılandırması, Redis
  kesintisi, job tekrarları, claim/dedup, pazarlama izni, admin rolü, CSRF, gerekçe ve
  imzalı webhook kontrollerini kapsar. Testlerde gerçek müşteriye e-posta gönderilmedi.
- Gerçek yerel PostgreSQL: **3/3 geçti**. Tüm migration geçmişi izole test şemasına
  uygulandı; iş + outbox rollback'i, eşzamanlı tekilleştirme ve eski webhook sonucunun
  araya giren şikâyet kaydını ezememesi doğrulandı. Test şeması temizlendi.
- Prisma Client üretimi ayrı çıktı dizininde **başarılı**. Normal yerel üretimde açık
  Node sürecinin Windows DLL kilidi görüldüğü için mevcut sunucu durdurulmadı.
- `pnpm typecheck`: **8/8 görev geçti**. `pnpm lint`: **7/7 görev geçti**; mevcut
  dosyalardaki eski uyarılar sürüyor.
- Web, admin-panel ve seller-panel üretim build'leri **başarılı**. Açık yerel Next.js
  sunucusunun `.next` çıktılarıyla çakışan ilk ortak build yerine kaynakların ayrı yerel
  kopyalarında `next build` çalıştırıldı; üçünde de sayfa üretimi ve build trace tamamlandı.
- Genel `pnpm test` çalıştırmasında **2004 test geçti**, iki test atlandı; bir test
  dosyası yüklenemedi: `tests/security/csrf-route-production.test.ts` içindeki mevcut
  `@prisma/client` mock'u `NotificationType` sağlamıyor. İlgili enum import'u önceki
  commit'te de bulunuyor. Bu dosya değiştirilmedi; genel paket tamamen yeşil değildir.
  Sonradan eklenen altı retry-route güvenlik testi ayrıca yukarıdaki 39 teste dahildir.
- Canlı deploy, sağlayıcı webhook kurulumu ve gerçek test gelen kutusu kabulü **bekliyor**.

## Geri dönüş ve faz sınırı

Migration yeni alan/tablo ekler; eski deliveredAt anlamını yeni alana taşır. Şema tablolarını
silerek geri dönme. Eski uygulamalar yeni alanları kullanmaz. Worker eski sürüme alınırsa yeni
outbox kayıtlarını tüketmez; bu kayıtlar saklanmalı ve düzeltilmiş worker ile devam edilmelidir.
Yeni outbox kullanan üreticiler dururken worker rollback'i yapılmamalı; aynı release setindeki
üreticiler de geri alınmalıdır. Yeni bulk kuyruğu ve bekleyen outbox verisi silinmemelidir.

Canlı gelen kutusu kabul testi kullanıcı deploy'u sonrasında bekliyor. Faz 2 başlatılmadı.

## Sağlayıcı referansları

- [Resend SMTP ve idempotency](https://resend.com/docs/send-with-smtp)
- [Resend webhook Message-ID](https://resend.com/changelog/message-id-for-sent-emails)
- [Svix imza doğrulama](https://www.svix.com/guides/receiving/receive-webhooks-with-svix-cli/)
