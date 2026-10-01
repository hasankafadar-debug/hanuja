# Hanuja — 2026-10-01 yerel güvenlik denetimi

**Sonuç:** Üç yüksek riskli uygulama açığı ve bir koşullu yüksek riskli Compose varsayılanı yerelde düzeltildi. OTP, eski imza doğrulayıcısı ve geri yükleme provası ayrıca güçlendirildi. **Push/deploy yapılmadı; canlı sitenin riskleri kapatılmış sayılmaz.** Doğrulanmış yeni bir kritik açık bulunmadı; bu, kritik açık bulunmadığına dair garanti değildir.

## Kapsam ve yöntem

Kullanıcının onayladığı plan doğrultusunda `web`, `seller-panel`, `admin-panel`, paylaşılan `api/`, security/SEO paketleri, Prisma şeması, worker, yerel altyapı ve operasyon belgeleri incelendi. Kart satışının kapalı, havale/EFT'nin etkin olduğu ve çok satıcılı siparişlerin bulunduğu bağlam kullanıldı. Ölçek, canlı konfigürasyon ve gerçek banka/sağlayıcı durumları bilinmiyor.

Yerel envanter **231 API route dosyası / 165 mutasyon içeren dosya** belirledi. Otomatik metin eşleşmeleri yalnız inceleme adaylarıdır; tüm handler'ların her satırının manuel olarak denetlendiği iddia edilmez. Özellikle kimlik, roller, finans, iade/uyuşmazlık, özel medya ve yükleme sınırları üzerinde derinlemesine inceleme yapıldı.

Kod, bağımlılık grafiği ve raporlar harici tarayıcıya/Cloud servisine gönderilmedi. Paket indirilmedi. `pnpm audit` kullanılmadı: önceki otomatik onay incelemesi bağımlılık grafiğini registry'ye gönderen işlemi reddetmişti; kullanıcı bu adımı plandan çıkardı. Güncel CVE/advisory durumu **doğrulanamadı**.

Gerçek `.env` içerikleri rapor toplamak için okunmadı. Testlerde sağlayıcı/e-posta/depolama/veritabanı yan etkileri taklit edildi; auth testleri kendi geçici SQLite verisini, şifreli dosya testleri geçici dizinlerini kullandı. Test/build Node süreçleri ağ engelleme preload'u ile çalıştı. TCP, TLS, HTTP(S), DNS, UDP ve fetch için **11 engelleme kontrolü** geçti. Yalnız `tsx` test aracının yerel named pipe iletişimi ve ağ kullanmadan localhost çözümlemesi serbesttir. Bu guard işletim sistemi ağ izolasyonu değildir; native binary'leri kapsamaz. Build veri bağlantıları sentetik loopback adreslerine ayarlandı; üretim DB testi veya gerçek yedekleme komutu çalıştırılmadı.

## Doğrulanan ve düzeltilen bulgular

| Kimlik | Öncelik | Bulgu | Durum |
|---|---|---|---|
| AUD-001 | Yüksek | JSON-LD içindeki ürün metni HTML script sınırından çıkabiliyor | Yerelde düzeltildi; canlıda uygulanmadı |
| AUD-002 | Yüksek | Bazı admin mutasyonlarında, özellikle platform banka hesabında CSRF açığı | Yerelde düzeltildi; canlıda uygulanmadı |
| AUD-003 | Yüksek | Aynı siparişin diğer satıcısı, satıcıya atanmış iade/uyuşmazlık kanıtına ulaşabiliyor | Yerelde düzeltildi; canlıda uygulanmadı |
| AUD-004 | Orta | Banka OTP'si düz metin ve eşzamanlı tekrar kullanıma açık | Yerelde düzeltildi; canlıda uygulanmadı |
| AUD-005 | Düşük | Kapalı iyzico webhook doğrulayıcısında bozuk imza exception üretiyor | Yerelde düzeltildi; canlıda uygulanmadı |
| AUD-006 | Koşullu yüksek | Üretim Compose parolası eksikse bilinen DB parolası kullanılıyor | Yerelde düzeltildi; canlıda uygulanmadı |
| AUD-007 | Orta | Restore provası yanlış DB URL'sinde mevcut veriyi silebiliyor | Yerelde düzeltildi; canlıda uygulanmadı |

### AUD-001 — Ürün bilgisi üzerinden saklanan XSS

- **Kaynak:** `packages/seo/src/json-ld.tsx:12`; tüketici `apps/web/src/app/(storefront)/urun/[slug]/page.tsx`.
- **Önkoşul:** Saldırganın yayımlanan ürün/SEO metnini etkileyebilmesi ve kurbanın ilgili sayfayı açması. Anonim veri yazma yetkisi varsayılmadı.
- **Etki:** Önceki ham JSON çıktısındaki `</script>` HTML parser tarafından kapanış etiketi kabul edilebiliyordu. Kurban origin'inde script çalıştırma, erişebildiği bilgileri dışarı aktarma veya kurban adına işlem yapma olasıdır. HttpOnly cookie doğrudan okunmasa da oturumlu işlemler korunmuş sayılmaz.
- **Çözüm:** JSON serileştirmede `<` karakteri `\u003c` olarak yazılıyor; JSON değeri değişmiyor.
- **Kanıt:** Gerçek `JsonLd` bileşeni React server renderer ile çalıştırıldı. Üç saldırı girdisinde tek script sınırı ve JSON roundtrip doğrulandı: `tests/security/json-ld-script-escape.test.ts`.

### AUD-002 — Finansal ayarlarda CSRF ve ortak Origin sınırı

- **Kaynak:** `apps/admin-panel/src/app/api/admin/bank-accounts/route.ts:33`, `[id]/route.ts:28,52`; `packages/security/src/request-origin.ts:11`; üç uygulamanın `src/middleware.ts` dosyası.
- **Önkoşul:** Admin/satıcı/müşteri oturumunun kullanıldığı tarayıcıyı başka origin'den işlem yapmaya yönlendirme. SameSite lax nedeniyle özellikle aynı siteye ait ele geçirilmiş sibling origin anlamlıdır; tüm anonim cross-site POST'ların cookie taşıdığı iddia edilmez.
- **Etki:** Platform havale hesabını değiştirme/silme ve benzeri oturumlu mutasyonları tetikleme; alıcı IBAN değişikliği para yönlendirme riski taşır.
- **Çözüm:** Banka POST/PATCH/DELETE gerçek handler'larında CSRF token kontrolü; admin formunda `csrfFetch`. Üç uygulamada tüm `/api/:path*` mutasyonlarına üretimde aynı-Origin/Fetch Metadata kontrolü eklendi; uzantılı API yolları da matcher kapsamındadır. Kimlik/yetki kontrolleri korunur.
- **İstisnalar:** Yalnız web'deki mevcut ödeme callback, iyzico/Resend webhook ve iki Postmark inbound yolu, kendi imza/Basic Auth kontrolleri nedeniyle kaynak kontrolünden muaftır. Keyfi yeni webhook yolu muaf değildir. Kart uçları ayrıca kapalıdır.
- **Push öncesi incelemede eklenen istisna:** İlk sürüm `/api/marketing/unsubscribe` yolunu muaf tutmuyordu. RFC 8058 tek tıkla çıkış isteği e-posta sağlayıcısının sunucusundan Origin olmadan geldiği için 403 alıyor, rıza geri çekilmiyordu. Yol, opt-out token'ı kimlik olduğu ve cookie kullanılmadığı için muaf listesine eklendi. Kanıt: `api-origin-boundary.test.ts` (tek tıklama + komşu yollar), `third-party-post-origin-exemptions.test.ts` (sağlayıcı uçlarını dosya sisteminden türetir).
- **Kanıt:** Gerçek üç middleware'de 39 senaryo; gerçek banka handler'larında eksik/bozuk token, yanlış rol ve geçerli admin için 12 senaryo: `api-origin-boundary.test.ts`, `platform-bank-csrf.test.ts`. İzinli form/fetch akışı korunuyor.
- **Uygulama şartı:** Her app'in `BETTER_AUTH_URL` değeri yayımlanan origin'i göstermelidir. Cookie kullanan CLI istemcileri doğru Origin ve handler'ın istediği token'ı göndermelidir. Middleware tek başına auth veya oturum ele geçirme savunması değildir.

### AUD-003 — Çok satıcılı siparişte iade/uyuşmazlık gizliliği

- **Kaynak:** `api/lib/participant-scope.ts:4,16`, `api/routes/media.ts:241,282`, `api/repositories/dispute.repository.ts:77`.
- **Önkoşul:** Siparişte kendi ürünü bulunan satıcı B'nin, satıcı A'ya atanmış iade/uyuşmazlık veya medya kimliğini bilmesi.
- **Etki:** Diğer satıcının iade belgesi/mesajı/kanıtı ifşa olabilir; uyuşmazlık mesaj hedefi de gereğinden geniş seçilebilirdi. Önceki kontrol yalnız siparişte herhangi bir satırın bulunmasını arıyordu.
- **Çözüm:** Session satıcı rolünde seller ID sunucudan çözülür. İadede `sellerId`, eskale uyuşmazlıkta bağlı iadenin satıcısı denetlenir. Dosya ve uyuşmazlık okuma/mesaj hedefi aynı kapsamı kullanır. Yetkisiz ve olmayan dosya için aynı `404`, `private, no-store`; depolama çağrısı yapılmaz.
- **Kanıt:** Gerçek medya handler'ı ve repository query'si iki satıcılı fixture'a uygulanarak 12 senaryo; mevcut medya 12 ve dispute authorization service 13 testi de geçti. Test predicate değerlendiricisi authorization kuralını yeniden yazmaz; handler'ın oluşturduğu Prisma query'sini değerlendirir. **Gerçek PostgreSQL relation/lock davranışı çalıştırılmadı.**
- **Kalan sınır:** `sellerId=null` legacy iadeler ve iadesiz sipariş-geneli uyuşmazlıklar mevcut tüm sipariş katılımcısı davranışını korur. Historical veri backfill gereksinimi ve bu belgelerin hassasiyeti canlı veriye bakılmadığı için bilinmiyor. R2 CDN bypass'ı ayrı açık kontrol kalemidir.

### AUD-004 — Finansal OTP gizliliği ve tek kullanım

- **Kaynak:** `api/lib/seller-bank-otp.ts:9`; seller `bank-details/route.ts:65,86` ve `step-up/request/route.ts:51,57`.
- **Önkoşul:** Geçerli satıcı oturumu ve kod, ya da veritabanı okuma erişimi ile kısa süreli doğrulama koduna erişim. Tek başına OTP bulmak yeni IBAN'ı hemen aktif yapmaz; 24 saat/admin doğrulaması korunur.
- **Etki:** Bir kod iki eşzamanlı finansal talepte kullanılabiliyordu; DB okuma sızıntısı altı haneli kodu açığa çıkarıyordu.
- **Çözüm:** Satıcı/kullanıcı kapsamlı HMAC-SHA256; zorunlu runtime secret; expiry ve digest ile atomik `deleteMany`, yalnız `count=1` iken değişiklik. Kod finansal servis çağrısından önce tüketilir. Rol ve geçici parola kontrolü handler'dadır. OTP mailindeki isim HTML-escape edilir.
- **Kanıt:** Gerçek iki handler ve HMAC helper'ı ile 25 senaryo: yanlış kod, farklı satıcıya ait kod, süresi dolmuş kayıt; iki eşzamanlı istekten tek başarı, code claim yarışı, expiry filtresi, eksik secret, rol, parola, rate limit ve CSRF. Veritabanı/e-posta/finans servisi taklit edildi; gerçek DB yarış testi değildir.
- **Davranış değişikliği:** Servis hatasında yeni kod gerekir. Eski düz metin bekleyen kodlar geçersizleşir. Kod belirli bir IBAN/istek içeriğine bağlanmış işlem imzası değildir; auth secret ve mail hesabı birlikte ele geçirilirse bu kontrol yeterli değildir.

### AUD-005 — Bozuk imza exception'ı

- **Kaynak:** `api/lib/iyzico.ts:393`.
- **Önkoşul/etki:** Kart webhook'u şu anda koşulsuz kapalı olduğundan canlı erişilebilir bir ödeme bypass'ı değildir. Gelecekte handler açılırsa farklı uzunlukta signature `timingSafeEqual` exception'ıyla gereksiz 500 üretirdi.
- **Çözüm/kanıt:** Buffer uzunluğu eşit değilse `false`. Gerçek verifier için altı test geçti. Genel webhook replay testindeki kopya implementasyon kaldırıldı; 20 test artık gerçek security modülünü çağırır. Bu genel modülün replay cache'i bellek içidir; çok instance idempotency kanıtı sayılmaz.

### AUD-006 — Bilinen Compose DB parolası

- **Kaynak:** `docker-compose.production.yml:24,77,106,134,160`.
- **Önkoşul:** Bu referans Compose'un eksik `POSTGRES_PASSWORD` ile kullanılması ve saldırganın DB ağına/başka servise erişim kazanması. Compose DB portunu public yayımlamıyor; anonim internetten doğrudan DB erişimi varsayılmadı. Coolify'daki gerçek parola bilinmiyor.
- **Etki:** Bilinen parola nedeniyle ikinci bir ağ/container ihlalinin toplu veri ifşası veya değişikliğine dönüşmesi.
- **Çözüm/kanıt:** Tüm fallback'ler zorunlu `${POSTGRES_PASSWORD:?...}` oldu. Parola eksikken gerçek Compose config çözümlemesi başarısız; sentetik parola ile `config --no-env-resolution --quiet` başarılı. Servis başlatılmadı, image çekilmedi, gerçek `.env` değerleri çıktı verilmedi. Parola gücü veya mevcut volume kullanıcısının rotasyonu bu değişiklikle kanıtlanmaz.

### AUD-007 — Geri yükleme provasında veri silme riski

- **Kaynak:** `tools/ops/restore-drill.sh:20,34`.
- **Önkoşul:** Yetkili operatörün yanlış DB URL'siyle drill çalıştırması; anonim uzaktan sömürü varsayılmadı.
- **Etki:** Eski `pg_restore --clean --if-exists` mevcut hedef DB nesnelerini silebilirdi.
- **Çözüm:** Restic çağrısından önce `psql` ile boş, `hanuja_restore_drill[_alfanumerik]` adlı DB şartı; `--clean` kaldırıldı, `--exit-on-error` eklendi. Runbook güncellendi.
- **Kanıt:** Bash syntax kontrolü ve **4 gerçek-script senaryosu** command stub'larıyla geçti. Reddedilen hedef/DB hatasında backup veya restore çağrısı yapılmadığı; geçerli fixture'da temizleme bayraklarının olmadığı görüldü. SQL'in gerçek PostgreSQL'de çalışması, restore ve belge decrypt **doğrulanamadı**. Eşzamanlı başka restore/writer çalıştırılmaması operasyon şartıdır.

## Üç hedef için değerlendirme

| Alan | Yerel kanıt | Kalan sınır |
|---|---|---|
| Müşteri/satıcı verisi | Ownership/DTO/CSV/e-posta projeksiyon testleri; yeni tenant ayrımı | Legacy paylaşım, canlı veri ve rol kayıtları doğrulanamadı |
| KYC/sözleşme/özel belge | `private-document-storage.ts`: AES-256-GCM, rastgele IV, key'e bağlı AAD, path allowlist; gerçek geçici dosya testleri geçti | Canlı key/volume izinleri, DB/disk şifrelemesi, anahtar yedek ve rotasyon pratiği bilinmiyor |
| Özel medya | Uygulama public proxy'si managed host/public prefix ile sınırlı; private handler session/katılımcı ve no-store kullanır | **Eski raporun doğrudan CDN/bucket erişimi riski güncel durumda doğrulanamadı; yerel handler düzeltmesi bunu kapatmaz** |
| Havale/EFT | Admin role/permission+CSRF; tutar sunucudan; indirim sınırları, pending payment compare-and-swap ve audit/outbox testleri | Gerçek banka dekontu/onayı ve DB eşzamanlılık testi yapılmadı |
| İade/payout | Provider/order amount binding, refund cap/claim, seller finance locks, payout snapshot/IBAN uygunluk testleri | Gerçek transfer/provider davranışı ve üretim unique index/migration durumu bilinmiyor |
| Kart satışı | Gerçek üç handler'da 9 yeni test: her girdiyle 503, hiçbir provider/DB/session yan etkisi yok; env ile açılamıyor | Eski kart iadeleri ayrı service hattı; satış açılmadan provider sözleşmesi ve canlı callback yeniden değerlendirilmeli |
| Oturum/MFA/parola | Gerçek Better Auth config/rate limit ve parola değişikliği testleri; seller email OTP hashing, admin TOTP, trust revoke | 400 günlük trusted-device penceresi uzun; ele geçirilmiş cihaz/e-posta için politika kararı ve aktif oturum envanteri gerekli |
| CSRF/XSS | Yeni ortak origin katmanı, finansal token kontrolleri, JSON-LD escape; mevcut blog sanitize testleri | Tam CSP script politikası yok; aynı-origin XSS tek başına CSRF ile engellenmez |
| SQL/komut/SSRF | Unsafe SQL adayları sabit `SET LOCAL`; diğer finans query'leri parametreli Prisma.sql. Sabit `eval('require')` SDK loader'ı kullanıcı girdisi çalıştırmıyor. Public medya proxy arbitrary URL fetch yerine izinli storage key okuyor | Otomatik eşleşme tüm SQL/egress'i güvenli ilan etmez; SSRF canlı ağ/redirect/metadata deneyi yapılmadı |
| Yükleme/worker/DoS | Boyut, mime/key, bounded read ve worker decode limitlerine ilişkin gerçek service testleri geçti | Canlı queue concurrency, container CPU/RAM, reverse proxy body limitleri bilinmiyor |
| Log/önbellek | Private no-store ve dar DTO'lar; IBAN audit masking | Bazı server error log'ları ham hata nesnesi tutuyor; gerçek retention/redaction/erişim izinleri ve CDN cache kuralları bilinmiyor |
| Altyapı | Referans Compose DB/Redis/search public port açmıyor; bilinen DB fallback kaldırıldı | Coolify erişimi/MFA, origin port erişimi, Cloudflare WAF/HSTS/R2, container ağları, Redis/Meilisearch credential'ları doğrulanamadı |
| Yedek/olay müdahale | Hourly DB / 6h full Restic script+timer; IR ve launch belgeleri var; drill güvenlik guard'ı eklendi | Timer'ın çalıştığı, Restic doğrulama, alarm teslimi, RPO/RTO, DB restore + belge decrypt + uygulama smoke kanıtı yok |
| Bağımlılıklar/CI | Yerel manifests/lockfile ve Next 15.5.22 patch incelendi; patch React scheduling davranışı için | Güncel advisory, transitive CVE ve upstream yayın doğrulaması yok; mevcut pin/yama sürümü güncel güvenlik kanıtı değildir |

## Açık kontrol kalemleri

1. **Öncelik yüksek, canlı doğrulanamadı:** Önceki `HNJ-SEC-003` doğrudan public R2 custom domain erişimi. Public/private nesneler ayrı private/public bucket veya auth gateway sınırına alınmalı; eski private URL/key ve cache erişimleri kapatılmalı. Gerekli Cloudflare değişikliği ve veri taşıması yerel görevde yapılmadı. Gerçek müşteri nesnesi sorgulanmadı.
2. **Orta:** Legacy `sellerId=null` iadelere atanacak seller/backfill ve sipariş-geneli uyuşmazlık paylaşımının ürün politikası belirlenmeli. Bu denetim historical kayıtları değiştirmedi.
3. **Orta:** `rate-limit-redis.ts` Redis hata durumunda instance belleğine düşer. Dağıtık koruma zayıflar; banka OTP ve diğer yüksek riskli işlemler için fail-closed davranış/servis sağlık şartı değerlendirilmelidir. Proxy'nin `x-forwarded-for` başlığını temizlediği kanıtlanmadı.
4. **Orta:** 400 gün trusted-device, ham server hata log'ları ve Postmark inbound JSON gövdesinin handler'da streaming boyut sınırı olmaması operasyonel inceleme ister. Bunlardan yeni bir anonim veri sızıntısı veya RCE kanıtı çıkmadı.
5. **Doğrulanamadı:** Genel secret taraması yalnız dar credential/private-key pattern'lerini içerdi; sıfır eşleşme tüm repo/Git geçmişinin secretsiz olduğunu göstermez. Gerçek runtime secret değerleri, scope ve rotasyon incelenmedi.

## Test sonucu ve kabul sınırı

| Kontrol | Sonuç |
|---|---|
| Başlangıç security paketi | 26 dosya, 383 test geçti |
| Son security paketi | **33 dosya, 489 test geçti** |
| Tam yerel Vitest paketi | **258 dosya, 2.584 test geçti; 0 başarısız** |
| Yeni regression kapsamı | 7 security dosyası, **106 yeni test**; gerçek handler/helper/repository/component |
| Typecheck | web, seller-panel, admin-panel, API, security, SEO geçti |
| Lint | Üç app ve security/SEO geçti; app'lerde mevcut uyarılar var. Değişen API/test dosyaları mevcut security ESLint config'iyle ayrıca geçti |
| Production build | web, seller-panel, admin-panel geçti; telemetry kapalı, sentetik bağlantı ayarları |
| Ağ guard | 11 probe geçti; yerel test IPC istisnası belgeli |
| Compose config | Eksik secret reddedildi; sentetik secret ile config kontrolü geçti |
| Restore guard | Bash syntax ve 4 stub senaryosu geçti; gerçek restore yapılmadı |
| Gerçek PostgreSQL test paketi | **Çalıştırılmadı**; mevcut `tests/postgres` varsayılan Vitest kapsamı dışında, bu oturumda disposable DB sağlanmadı |
| Browser E2E/canlı test | **Çalıştırılmadı**; middleware/unit sonucu canlı tarayıcı/network akışı kanıtı değildir |

İlk tam çalıştırmadaki dört `check-env` testi, preload'un tsx yerel IPC'sini engellemesi nedeniyle başarısızdı. Guard yalnız o yerel pipe'a izin verecek şekilde düzeltildi; ilgili testler ve son tam çalıştırma başarılı oldu. React component testi için zaten kurulu app React renderer'ı test resolver'ına bağlandı; bağımlılık yüklenmedi. Kopya webhook mantığı kanıt yerine gerçek modül testiyle değiştirildi; diğer eski testlerin tümü tek başına güvenlik kanıtı kabul edilmedi.

## Kanıtlar ve teslim

- [Tehdit modeli](hanuja-threat-model.md): varlıklar, güven sınırları, saldırı önkoşulları ve kalan tehditler.
- [Test özeti](kanitlar/test-results.json): temizlenmiş dosya/sayı/sonuç kayıtları; raw test output ve customer data içermez.
- [Kontrol özeti](kanitlar/verification.json), [ağ kanıtı](kanitlar/network-proof.json), [envanter](kanitlar/inventory.json).
- [Yerel tekrar çalıştırma](README.md): paket indirme ve harici audit gerektirmeyen komutlar.

Görev dosyaları küçük yerel commit gruplarıyla kaydedilir; ilgisiz `.claude`, `CLAUDE.md`, `.agents`, `outputs` değişiklikleri dahil edilmez. Repo `.githooks/post-commit` otomatik push içerdiği için bu görevin commit komutlarında **yalnız o komut için hooksPath devre dışı bırakılır**. Push/deploy/live konfigürasyon değişikliği yapılmaz.

Canlıya uygulama öncesindeki ayrı iş: R2 erişim sınırını doğrulama/düzeltme, current advisories, gerçek disposable PostgreSQL yarış/restore testleri, her app'in canonical origin ve meşru form/fetch akışı, provider credential'ları, alarm teslimi ve kontrollü rollout. Bu sonraki iş kullanıcı bu yerel sınırı değiştirmeden otomatik başlatılmaz.
