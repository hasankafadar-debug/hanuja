# Hanuja Güvenlik Denetimi — Yönetici Değerlendirmesi ve Düzeltme Planı

**Tarih:** 2026-08-03
**Kapsam:** `web`, `seller-panel`, `admin-panel`, paylaşılan `api/` katmanı, worker medya hattı ve canlıda düşük etkili HTTP/CDN kontrolleri
**Yöntem:** Claude raporunun bağımsız kaynak kod doğrulaması, tehdit modelleme, üretim bağımlılık denetimi ve saldırı gerçekleştirmeyen canlı başlık/CDN gözlemleri

## Yönetici özeti

Claude raporunun ana yönü doğrudur: uyuşmazlık yetkilendirmesi, özel medya erişimi, auth secret fallback'i, gölgelenen middleware ve satıcı PII tutarsızlıkları gerçek sorunlardır. Ancak ilk raporda bazı önem dereceleri ve etki açıklamaları fazla geniş tutulmuştur.

En acil gerçek riskler şunlardır:

1. Geçerli oturumu olan alakasız bir kullanıcı, kimliğini bildiği bir uyuşmazlığı okuyabilir ve açık uyuşmazlığa mesaj ekleyebilir.
2. Aynı R2 kovasında hem public hem private nitelikli nesneler bulunur. Uygulamanın kimliksiz proxy'si bilinen bir anahtarı okuyabilir; ayrıca canlı `media.hanuja.tr` kovayı doğrudan yayınladığı için yalnız proxy düzeltmesi yeterli değildir.
3. Üç auth uygulaması env eksikliğinde repo içinde bilinen bir secret'a düşer. Üretimde merkezi env doğrulaması normalde bunu engeller; fakat `SKIP_ENV_VALIDATION=true` ile kontrol atlanabildiği için canlı yapılandırma doğrulanmadan risk kapalı sayılamaz.
4. İnceleme başlangıcında proje Next.js `15.5.14` kullanıyordu. Bu sürüm, daha yeni 15.5.x güvenlik yamalarının gerisindeydi ve upstream tarafından yayımlanmış birden çok High advisory'den etkileniyordu.
5. İnceleme başlangıcında presigned upload hattındaki boyut sabitleri fiilen uygulanmıyor; tam nesne belleğe alınıp Sharp worker'a gönderilebiliyordu. Kimliği doğrulanmış bir saldırgan büyük/sıkıştırma bombası niteliğinde girdilerle web veya worker kaynaklarını tüketebilirdi.

Bu denetim, mevcut ödeme bağlama kontrolleri, step-up grant'leri, seller/order filtreleri, KYC şifreli yerel depolaması ve server-side üretilen R2 anahtarları gibi güçlü kontrolleri de doğrulamıştır. Sonuç “platform tamamen güvensiz” değildir; birkaç kritik güven sınırı merkezi ve test edilebilir hale getirilmelidir.

## Canlı gözlemler

2026-08-03 tarihinde yalnız HEAD/GET tabanlı, veri tahmini yapmayan kontroller yapıldı:

- `www`, `satici` ve `admin` uçları HTTPS üzerinden yanıt verdi.
- Canlı seller/admin ana sayfa yanıtlarında `X-Frame-Options` ve `Content-Security-Policy: frame-ancestors` görülmedi; bu, aktif middleware gölgelenmesi bulgusuyla uyumludur.
- Yanıtlarda `Strict-Transport-Security` görülmedi. Bu başlık Cloudflare/Coolify katmanında ayrıca ele alınmalıdır.
- `media.hanuja.tr` üzerindeki ana sayfada zaten yayımlanan bir ürün görseli doğrudan `200` döndürdü. Bu, custom domain'in R2 nesnelerini doğrudan yayımladığını doğrular; private bir anahtar denenmedi ve hiçbir özel nesne okunmadı.
- `X-Powered-By: Next.js` gereksiz teknoloji ifşasıdır; düşük öncelikli hardening maddesidir.
- Coolify'da değerler açılmadan yapılan kontrolde dört serviste de 64 karakterlik `BETTER_AUTH_SECRET`, 35 karakterlik `TURNSTILE_SECRET_KEY` bulundu ve `SKIP_ENV_VALIDATION` tanımlı değildi. Bu nedenle canlıda fallback'in etkin olduğuna dair işaret yoktur; kod riski yine kaldırılmalıdır.
- Coolify'daki dört servis `codex/release-2026-07-15` dalını ve `HEAD` commit ayarını izlemektedir. İnceleme anında seller/admin/worker dalın mevcut `5825c92` ucunu çalıştırırken web daha eski `bb056c7` commit'indeydi; web için push sonrası açık redeploy zorunludur.

## Uygulama durumu

Kod düzeltmeleri 2026-08-03 tarihinde tamamlandı; bu bölüm deploy öncesi kod durumunu kaydeder. Canlı kabul sonuçları deploy sonrasında ayrıca doğrulanacaktır.

- Dispute read/message işlemleri viewer kimliğiyle DB seviyesinde customer/order-line seller ilişkisine bağlandı. Yetkisiz ve bulunmayan nesne aynı 404 davranışını alıyor; participant projection'ı order/payment ve storage key alanlarını taşımıyor.
- Public medya proxy'si exact managed host, canonical path ve public prefix allowlist'iyle sınırlandı. Return, dispute ve iki support akışının ekleri asset ID + DB ilişkisiyle yetkilendirilen `private, no-store` route'lara geçirildi. Doğrudan Cloudflare custom-domain erişimi HNJ-SEC-003 olarak açık kalır.
- Auth ve Turnstile literal fallback'leri kaldırıldı; production env-validation skip'i reddediliyor. Canlı secret varlığı/uzunluğu değerleri açılmadan doğrulandı.
- Gölge middleware dosyaları kaldırıldı; aktif seller/admin middleware'leri rol, geçici parola ve anti-frame kurallarını birleştiriyor. Geçici parolalı seller'ın API çağrıları da parola oluşturma route'u dışında engelleniyor.
- Seller contract buyer e-postası seller'a verilen kopyada maskeleniyor; immutable legal snapshot/hash değişmiyor. Seller orders JSON ve CSV ortak maskeli projection kullanıyor.
- Dört step-up'sız admin route'u ile seller ilk-parola route'u CSRF kontrolüne ve `csrfFetch` istemcisine geçirildi. Production-semantics handler testleri token yokluğu/uyuşmazlığı için 403 ve geçerli token için devam davranışını doğruluyor.
- Upload confirm, gerçek R2 `ContentLength`/`ContentType` değerini işleme/kuyruk öncesi doğruluyor. 10 MiB görsel/video ve 20 MiB document/support sınırları, bounded stream okuması, 15 saniyelik external fetch timeout'u ve Sharp `limitInputPixels=36_000_000` eklendi.
- Tüm workspace Next.js çözümlemeleri `15.5.22`, tüm Sharp çözümlemeleri `0.35.3` oldu.

## Doğrulanmış bulgular

| ID | Önem | Bulgu | Önkoşul / etki | Karar |
|---|---|---|---|---|
| HNJ-SEC-001 | High | Uyuşmazlık okuma ve mesaj yazma yetkilendirmesi katılımcı kontrolü yapmıyor | Geçerli oturum ve hedef CUID gerekir; özel mesaj/kanıt ifşası ve inceleme kaydına mesaj enjeksiyonu mümkündür | Derhal düzelt |
| HNJ-SEC-002 | High | Kimliksiz medya proxy'si private prefix'leri ve herhangi bir `*.r2.dev` hostunu kabul ediyor | Bilinen/ifşa olmuş nesne anahtarı gerekir | Derhal düzelt |
| HNJ-SEC-003 | High | Canlı custom domain aynı kovadaki tüm anahtarlara doğrudan erişim katmanı oluşturuyor | Private nesne anahtarı gerekir; uygulama proxy'si atlanır | Cloudflare + uygulama birlikte düzelt |
| HNJ-SEC-004 | Critical (koşullu) | `BETTER_AUTH_SECRET` eksikse bilinen literal fallback kullanılıyor | Yalnız fallback üretimde devreye girdiyse session forgery etkisi Critical olur | Fallback'i kaldır; canlı env ve geçmiş kullanımı doğrula |
| HNJ-SEC-005 | High | Next.js 15.5.14 güncel 15.5.x güvenlik yamalarının gerisinde | Etki ilgili Next özelliği ve route kullanımına bağlıdır; upstream High advisories vardır | 15.5.22'ye yükselt |
| HNJ-SEC-006 | High | Seller/admin aktif middleware'leri rol, geçici parola ve frame korumalarını içermiyor | Geçerli panel oturumu; clickjacking için kurban etkileşimi gerekir | Aktif `src/middleware.ts` dosyalarında birleştir |
| HNJ-SEC-007 | High | Presigned upload boyutu imzaya/confirm'e bağlanmıyor; nesne tam belleğe ve Sharp'a alınabiliyor | Kimliği doğrulanmış uploader gerekir; web/worker DoS | Boyut, kota ve decode limitlerini uygula |
| HNJ-SEC-008 | High / Medium | Step-up'sız yüksek etkili admin mutasyonlarında CSRF token kontrolü yok | Admin oturumu ile aynı-site sibling origin üzerinde script çalıştırma gerekir | Hedef route + istemci çiftini birlikte düzelt |
| HNJ-SEC-009 | Medium | Seller sözleşme görünümü buyer e-postasını açık taşır | İlgili siparişin seller'ı gerekir; authz bypass değildir | Immutable snapshot korunarak seller-safe görünümde maskele |
| HNJ-SEC-010 | Medium | Seller orders JSON dalı `customer.name` alanını CSV'den farklı olarak maskesiz döndürür | Seller yalnız kendi siparişlerini görür | Ortak seller DTO/projection kullan |

## Claude raporuna yapılan düzeltmeler

- HNJ-SEC-001 “herhangi bir anonim kişi” değil, geçerli oturumu ve hedef CUID'i olan alakasız kullanıcı saldırısıdır. Yine de High'dır.
- Normal doğrudan uyuşmazlık okuması her durumda `order.payments` döndürmez; geniş finansal veri özellikle return escalation nesnesinde ortaya çıkar. Kullanıcı ve admin projeksiyonları yine ayrılmalıdır.
- Mesaj route'u request body'den keyfi `authorRole` kabul etmez; rol session'dan gelir. Açık, katılımcı olmayan kullanıcının mesaj ekleyebilmesidir.
- Seller/admin layout'larında server-side auth kontrolleri bulunduğu için middleware sorunu “panel tamamen auth bypass” değildir. Gerçek etkiler geçici parola zorunluluğunun atlanması ve frame korumasının eksikliğidir; seller API guard'ı da ayrıca güçlendirilmelidir.
- Seller'a telefon ve teslimat alıcısı adı mevcut iş kuralına göre fulfillment için bilinçli açıktır. Doğrulanan politika ihlali buyer account e-postası ve `customer.name` tutarsızlığıdır.
- Step-up grant isteyen EFT/payout/bank-detail işlemlerinde grant custom header'ı klasik CSRF'yi ayrıca zorlaştırır; en yüksek öncelik step-up'sız penalty/platform settings/return ve benzeri yüksek etkili mutasyonlardır.
- `SameSite=Lax` bağımsız cross-site saldırıyı önemli ölçüde azaltır. Kalan senaryo sibling same-site origin'de script çalıştırma ve admin cookie kapsamının hedef hosta ulaşabilmesidir; cookie host/domain kapsamı canlı yapılandırmada doğrulanmalıdır.
- Turnstile placeholder secret bir auth bypass değil, üretimde fail-closed giriş kesintisi doğurur. Yine de sessiz fallback kaldırılmalıdır.

## Bağımlılık bulguları

Başlangıç `pnpm audit --prod` sonucu `0 critical / 37 high / 43 moderate / 7 low` idi. Patch ve lock yenilemesi sonrasında sonuç `0 critical / 4 high / 11 moderate / 2 low` oldu. Ham sayı risk seviyesi değildir; doğrudan ve erişilebilir yollar ayrıca incelendi.

- `next@15.5.14`: doğrudan ve internet-facing idi; root, üç uygulama ve SEO peer çözümü 15.5.22'ye yükseltildi. Son audit'te doğrudan Next advisory'si kalmadı.
- `sharp@0.33.5`: user-controlled medya worker'ında kullanılıyordu ve libvips güvenlik düzeltmelerinin gerisindeydi. Doğrudan paket ve Next'in optional transitif kopyası root override ile 0.35.3'e yükseltildi; son audit'te Sharp advisory'si kalmadı.
- Transitif `undici`, `ip-address`, `postcss`, `qs`, `fast-xml-builder`, `tmp` ve iki `brace-expansion` majör hattı kendi uyumlu güvenli sürümlerine selector/override ile taşındı. Exact sürüme pinli `fast-xml-parser`, `valibot` ve `@hono/node-server` üst paket sözleşmesi zorlanmadı; bu yollar kalan audit envanterindedir.
- `nodemailer@6.10.1`: son audit'te 2 High, 5 Moderate ve 1 Low doğrudan advisory kalır. En ağır `raw`/transport-option senaryolarında mevcut mailer saldırgana bu seçenekleri vermiyor; address-parser DoS ve alıcı yorumlama farkı için de uygulama email doğrulaması/uzunluk sınırları incelendi. Major yükseltme mail teslimi ve Better Auth akışlarıyla ayrı uyumluluk testi gerektirir.
- `xlsx@0.18.5`: npm'de güvenli sürümü olmayan prototype pollution/ReDoS advisory'leri vardır. Zararlı workbook parse'ı mevcut akışta seller'ın kendi tarayıcısında yapılır; server route'ları workbook üretir. Paket ExcelJS veya bakımlı bir alternatife ayrı işte taşınmalıdır.

Upstream referansları:

- Next.js güvenlik duyuruları: <https://github.com/vercel/next.js/security/advisories>
- Next.js Temmuz 2026 güvenlik sürümü: <https://nextjs.org/blog/july-2026-security-release>
- Cloudflare R2 public bucket erişim modeli: <https://developers.cloudflare.com/r2/buckets/public-buckets/>

## Uygulama planı

### Dalga 0 — canlı riski kapat

1. Uyuşmazlık read/write katılımcı kontrolünü merkezi servis sınırına ekle; eksik ve yetkisiz için aynı 404 davranışını kullan; user/admin projection'larını ayır.
2. Public medya proxy'sini kesin hostname, normalize edilmiş key ve public prefix allowlist ile sınırla. Private prefix'ler için asset kimliği + DB ilişkisinden yetki veren ayrı route kullan.
3. Cloudflare'da `r2.dev` public erişimini kapalı doğrula. `media.hanuja.tr` doğrudan bucket custom domain'i olarak kalacaksa private prefix'leri WAF/Worker ile engelle; tercih edilen kalıcı tasarım, custom domain'i public-prefix allowlist'li R2-binding Worker arkasına almak ve private dosyaları yalnız app authorization route'larından yayınlamaktır.
4. Bilinen auth/Turnstile fallback'lerini kaldır. Coolify'da dört servisin secret değerlerini **değerleri loglamadan** mevcut/uzunluk/placeholder bakımından doğrula. Fallback'in geçmişte üretimde kullanıldığına dair belirti varsa secret'ı döndür ve tüm session'ları geçersiz kıl.
5. Next.js'i 15.5.22'ye, Sharp'ı 0.35.3'e yükselt.

### Dalga 1 — yüksek etkili sınırları merkezileştir

1. Aktif seller/admin middleware'lerini tek kaynağa indir; frame koruması, rol redirect'i ve `mustChangePassword` uygula. Seller page helper ve merkezi API guard aynı kuralı zorlasın.
2. Presigned upload sonrası `HeadObject.ContentLength` ile folder bazlı limiti doğrula; aşan nesneyi sil/reject et. `readObject` için üst sınır ve Sharp `limitInputPixels` uygula. Owner/folder kota, rate limit ve worker backpressure takibini Dalga 2'ye taşı.
3. Step-up'sız yüksek etkili admin mutasyonlarına önce CSRF ekle; route ile istemciyi aynı commit'te değiştir. Native form POST kullanan return akışını `csrfFetch` kullanan client action'a dönüştür.
4. Seller-safe order DTO ve contract sanitizer'ı tek noktada uygula; saklanan hukuki snapshot/hash değişmemeli.

### Dalga 2 — hardening ve borç kapatma

1. Admin/seller auth rate limit'lerini Redis-backed ve endpoint bazlı hale getir.
2. `xlsx` değişimini ve Nodemailer major yükseltmesini uyumluluk testleriyle tamamla.
3. Cloudflare'da HSTS, uygun CSP raporlama, WAF/rate-limit kuralları ve public/private medya gözlemlenebilirliğini etkinleştir.
4. Sağlık endpoint'lerindeki ham altyapı hata metinlerini kaldır; public product projection'ını daralt; admin IBAN gösterimini yetki/purpose sınırına bağla.
5. Presigned PUT URL'nin süre dolana kadar yeniden kullanılabilmesi, reject-delete cleanup retry'si, owner/folder depolama kotası ve worker queue backpressure/alarmlarını ekle.
6. Native `returns/:id/mark-received` formunun sıfır refund tutarıyla zaten başarısız olan iş akışını ürün/finans kararıyla düzelt; ardından route ve istemciyi birlikte CSRF korumasına al.

## Kabul kriterleri

- Alakasız customer/seller uyuşmazlık GET ve message POST isteklerinde varlık bilgisi sızdırmadan 404 alır; customer, ilgili seller ve admin geçer.
- Kimliksiz media proxy yalnız public prefix'leri okur; yabancı `*.r2.dev`, traversal ve private prefix girdileri reddedilir.
- `media.hanuja.tr/returns/...` gibi private prefix'ler custom domain üzerinden 404/403 verir; yetkili kullanıcı uygulama route'u üzerinden dosyayı görür.
- Eksik, kısa veya placeholder `BETTER_AUTH_SECRET` ile hiçbir auth uygulaması başlamaz.
- Aktif middleware manifestinde seller/admin rol ve frame korumaları bulunur; geçici parolalı seller hem page hem API'de yalnız parola değiştirme akışına erişir.
- Seller order JSON/CSV aynı maskeli account adını verir; iki seller contract yolunda buyer e-postası maskelidir, DB snapshot/hash değişmemiştir.
- Korunan admin mutasyonlarında headersız istek 403, `csrfFetch` kullanan UI akışı başarılıdır; step-up header'ı korunur.
- Oversize upload confirm aşamasında işlenmeden silinir/reject edilir; worker bounded input ile çalışır.
- Lint, typecheck, görev odaklı güvenlik testleri ve üç Next build'i yeşildir; deployment sonrası üç health endpoint ve güvenlik başlıkları doğrulanır. Tam test paketindeki bu çalışmadan bağımsız, önceden mevcut eksik seller import route'ları ile Vitest `@/lib/step-up` alias çözümlemesi ayrıca onarılmalıdır.

## Açık operasyon kararları

1. Seller sözleşmesindeki buyer e-postası için varsayılan karar “maskeli”; ad/adres/telefon fulfillment amacıyla açık kalır.
2. Cookie'lerin host-only mi yoksa parent-domain kapsamlı mı olduğu canlı session response üzerinden doğrulanmalıdır.
3. R2 custom domain önünde public-prefix Worker/WAF uygulanmadan HNJ-SEC-003 kapatılmış sayılamaz.
4. Coolify kontrolü secret değerlerini açmadan yalnız varlık ve uzunluk doğrulamıştır; bu rapor hiçbir secret değerini, müşteri verisini veya private object key'ini kaydetmez.
5. Uygulama kodu Cloudflare R2 custom domain'ini değiştiremez. Cloudflare oturumu olmadan HNJ-SEC-003 için Worker/WAF veya bucket custom-domain değişikliği uygulanmamış; canlı risk kapalı sayılmaz.
