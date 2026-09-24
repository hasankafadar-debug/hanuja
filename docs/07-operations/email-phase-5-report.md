# E-posta Faz 5 — Görsel/video destekli satıcı duyuruları

**Tarih:** 24 Eylül 2026
**Kapsam:** admin panelinden satıcılara görsel veya video içeren operasyon duyurusu hazırlama, kesin
alıcı listesini önizleme, gönderme, gönderim ilerlemesini izleme ve yalnız başarısız alıcıları yeniden
deneme. Her satıcı ayrı e-posta alır; duyuru satıcı panelinde de görünür. Faz 1 (kalıcı gönderim) ile
Faz 3–4'ün outbox altyapısı üzerine kurulur.

---

## 1. Kullanıcı kararları (2026-09-23)

- Alıcılar yalnız **aktif ve askıdaki** satıcılar. Başvurusu beklemede veya reddedilmiş satıcılar panele
  giremediği için hiçbir modda alıcı olamaz.
- Video en fazla **50 MB** (MP4 veya WebM). MP4 (H.264/AAC) önerilir.
- "Doğrulanma" filtresi **Mağaza/KYC** sinyalidir (`SellerProfile.isVerified`).
- **Kodda kota sınırı yok.** Resend şu an ücretsiz planda (günde 100, ayda 3.000 e-posta). İş sahibi
  sınıra yaklaşıldığında ücretli plana geçecek.

## 2. Bilinçli tercihler ve sonuçları

- **Duyuru medyasında erişim kontrolü yok.** Dosyalar `announcements/` altında, tahmin edilemez ama herkese
  açık bir URL'de (`media.hanuja.tr`) durur. Bağlantıyı alan herkes görseli/videoyu açabilir; satıcı
  panelindeki yetkilendirme dosyanın kendisini korumaz. Bunun iki nedeni var: e-posta kapak görseli zaten
  herkese açık olmak zorunda ve video, iOS Safari'nin istediği HTTP Range desteği için doğrudan R2'den
  oynatılmalı (uygulamanın medya proxy'si Range desteklemiyor). **Kural:** duyurulara gizli bilgi içeren
  medya konmaz. Yükleme alanında bu uyarı gösterilir. Gerçek erişim kontrolü için planlanan Cloudflare yol
  allowlist'i ve imzalı GET gerekir (ayrı iş, HNJ-SEC-003).
- **Ayrı kuyruk kotayı ayırmaz.** `notification-bulk` yalnız sistemimiz içinde sırayı ve hızı ayırır; sipariş
  e-postaları duyuru yüzünden beklemez. Resend'in günlük kotası ise işlemsel e-postalarla **ortaktır**:
  büyük bir duyuru kotayı tüketirse o gün şifre sıfırlama ve sipariş e-postaları da durabilir. Gönder onay
  penceresi bu uyarıyı gösterir.
- **Kapasite sınırı yalnız duyuru katkısını bağlar.** Kampanya indirimi üreticileri toplu hatta bugünkü gibi
  sınırsız yazar; toplu hat onların etkisiyle geçici olarak 100'ü aşabilir.
- **Yalnız operasyonel içerik.** Duyuru `noreply` adresinden gider, pazarlama rızası aranmaz ve
  List-Unsubscribe eklenmez. Reklam/kampanya içeriği için kullanılmaz; müşteriye kampanya bu fazın dışında.

## 3. Veri modeli — migration `20260924090000_seller_announcements` (yalnız ekleme)

| Değişiklik | Açıklama |
|---|---|
| `enum AnnouncementStatus { draft, sent }` | İlerleme ayrı bir durumda tutulmaz, alıcı satırlarından türetilir. |
| `Announcement` | Düzenlenebilir `title/body` (panel kopyası) ve gönderimde dondurulan `sentTitle/sentBody`. `version` her taslak kaydında artar. `audience` (JSON), `audienceHash`, `recipientCount`, `mediaAssetId`/`posterAssetId` (FK `Restrict`), `sentAt`, `sentByAdminId`, `editedAfterSendAt`. |
| `AnnouncementRecipient` | Donmuş alıcı: `sellerId` (FK `SetNull`), `sellerDeletedAt`, `userId`, `sellerName` (gönderim anındaki mağaza adı), `eventKey = announcement:{id}:seller:{sellerId}`, `outboxWrittenAt`, `retryRequestedAt`, `readAt`. `@@unique([announcementId, sellerId])`. |
| `NotificationDelivery` | `@@index([eventKey])` — ilerleme join'i için. |
| Enum değerleri | `NotificationType.seller_announcement`; `AdminActionType.announcement_sent`, `announcement_updated_after_send`, `announcement_retry_requested` (`ADD VALUE IF NOT EXISTS`). |

Yeni ortam değişkeni yok.

## 4. Akış: taslak → önizleme → gönderim

1. **Taslak** (`/duyurular` → "Yeni duyuru"): başlık (≤150), düz metin (≤5000, satır sonları korunur),
   isteğe bağlı görsel ya da video + zorunlu kapak görseli, alıcı seçimi. Her kayıt `version` değerini
   kontrol eder; başka sekmede değişmiş taslak 409 döner.
2. **Önizleme:** sunucu kayıtlı seçimi çözer ve `{ count, version, audienceHash = sha256(sıralı sellerId) }`
   döner. Liste sayfalıdır, her satırda "Çıkar" vardır; çıkarma ve geri alma taslağı hemen kaydeder.
3. **Gönder:** onay penceresi alıcı sayısını ve ortak kota uyarısını gösterir. Sunucu tek transaction'da:
   - duyuru satırını `FOR UPDATE` ile kilitler (çift tık, eşzamanlı kaydetme veya silme bekler, sonra kaybeder),
   - `version` ve `audienceHash` önizlemeyle aynı değilse 409 döner ("Alıcı listesi değişti"),
   - medya kurallarını doğrular (video ise kapak zorunlu),
   - alıcıları 1000'lik parçalarla yazar, `sent*` alanlarını dondurur, `announcement_sent` denetim kaydı düşer.
   Outbox'a yazmaz; bunu dağıtım sweep'i yapar.

## 5. Alıcı seçimi (`api/domain/announcement-audience.ts`)

- Modlar: **Tüm satıcılar**, **Elle seçim** (arama: mağaza adı, slug, şirket adı), **Filtre**.
- Uygunluk (`active`, `suspended`) her modda uygulanır. Hariç tutulanlar her modda çıkarılır.
- Aynı filtre içindeki değerler "veya", farklı filtreler "ve" ile birleşir.
- **Konum** tek filtredir; değerler `{şehir, ilçe?}`. Şehir/ilçe serbest metin olduğundan Türkçe
  duyarsız anahtarla (`Kadıköy ` → `kadikoy`) gruplanır. İlçe şehrin altında tutulur; farklı şehirlerdeki
  "Merkez" karışmaz.
- **Doğrulama:** "doğrulanmamış", profili hiç olmayan satıcıları da kapsar.
- **Kayıt tarihi:** gün sınırları Türkiye saatiyle (+03:00); bitiş günü dahildir.
- **Kategori:** seçilen kategorinin alt ağacında (pasif dallar dahil) en az bir **yayındaki** ürünü olan satıcılar.
- **Mağaza/şirket adı:** `displayName` veya şirket adı içinde, büyük/küçük harf duyarsız.

## 6. Dağıtım sweep'i (`announcement-dispatch` kuyruğu)

Ayrı bir kuyruk ve worker (15 sn'de bir, concurrency 1). Relay job'ına dokunulmadı; sipariş e-postaları
bu işi hiç beklemez. Her tick tek, sınırlı bir transaction'dır:

1. `SET LOCAL lock_timeout = '2s'`, `statement_timeout = '5s'`; Prisma transaction süresi 10 sn.
2. `pg_try_advisory_xact_lock` alınamazsa tick biter (tek yazıcı).
3. `boş yer = 100 − (toplu hatta pending + queued outbox satırı)`; yer yoksa tick biter.
4. Yazılmamış alıcılar `FOR UPDATE SKIP LOCKED` ile en fazla boş yer kadar seçilir ve toplu `createMany
   skipDuplicates` ile outbox'a yazılır; `outboxWrittenAt` basılır.
5. Kalan yer kadar yeniden deneme istenmiş alıcı işlenir (bkz. §8).
6. Kilit/süre aşımında tick geri alınır, uyarı loglanır, iş bir sonraki tick'e kalır.

Advisory lock kapasite ölçümü ile yazmayı birlikte serileştirir; paralel worker'lar sınırı aşamaz. Outbox
payload'ı yalnız `{announcementId, sellerName, panelUrl}` taşır; e-posta içeriği gönderim anında donmuş
`sent*` alanlarından okunur. Böylece binlerce satır metin kopyası taşımaz ve yeniden denemeler de aynı
içeriği gönderir. In-app bildirimde başlık "Yeni duyuru", gövde duyuru başlığıdır.

## 7. İlerleme

Alıcı ↔ outbox ↔ en son e-posta teslim kaydı birleştirilir. Kovalar:

| Kova | Anlamı |
|---|---|
| Hazırlanıyor | Alıcı henüz outbox'a yazılmadı. |
| Kuyrukta | Outbox'ta bekliyor, gönderiliyor ya da BullMQ yeniden deniyor. |
| Yeniden deneme bekliyor | Admin yeniden deneme istedi; sweep kapasite açıldıkça işler. |
| SMTP kabul etti | Sağlayıcı kabul etti; teslim sonucu (webhook) bekleniyor veya bilinmiyor. |
| Teslim edildi / Geri döndü / şikâyet | Resend webhook sonucu. |
| Başarısız | Son deneme de başarısız. |
| Sonuç belirsiz | SMTP DATA aşamasında kesildi; e-posta gitmiş olabilir, otomatik yeniden denenmez. |
| Atlandı | E-posta bacağı bilinçli olarak üretilmedi (ör. hesap artık satıcı değil). |
| Hesap silindi | Satıcı sonradan kalıcı silindi (ayrıntı §10). |

Ekran, hazırlık/kuyruk/yeniden deneme sürerken 10 sn'de bir yenilenir. Ardından teslim sonucu bekleyen
satır varsa son SMTP kabulünden sonra 30 dakikaya kadar 60 sn'de bir yenilenir. "Yenile" butonu ve son
güncelleme saati her zaman görünür.

## 8. Yalnız başarısızları yeniden deneme

- **Önizleme:** son denemesi de başarısız olmuş, sonucu belirsiz olmayan, hesabı duran ve zaten yeniden
  deneme bekleyemeyen alıcılar listelenir. Diğerleri gerekçe sayılarıyla gösterilir. Liste `eligibleHash`
  ile bağlanır.
- **Onay:** gerekçe (10–500 karakter) zorunludur. İstek yalnız `retryRequestedAt` basar ve tek
  `announcement_retry_requested` kaydı yazar; outbox'a dokunmaz. Eşzamanlı ikinci istek kilit arkasında
  bekler ve liste değiştiği için reddedilir.
- **Uygulama:** sweep, tekli admin retry'ın korumalarını satır satır yeniden kontrol eder (belirsiz teslim
  yok, son hata kesin, outbox `failed/completed`). Tutarsa outbox `pending` ve `generation + 1` olur, teslim
  satırı `pending`'e döner; tutmazsa yalnız işaret temizlenir. Binlerce kayıtlık retry de 100'lük kapasiteye tabidir.

## 9. Gönderim sonrası düzenleme

Yalnız başlık ve metin düzenlenebilir; medya gönderimden sonra kilitlidir. Düzenleme panel kopyasını
değiştirir, `editedAfterSendAt` basar ve önceki/yeni metinle `announcement_updated_after_send` kaydı yazar.
**E-posta yeniden gönderilmez**; outbox'a dokunulmaz. E-postalar ve yeniden denemeler her zaman `sentTitle/
sentBody`'yi kullanır. Satıcı panelinde duyuru "Güncellendi" etiketiyle görünür.

## 10. Satıcı silindiğinde

Admin kalıcı silme işlemi aynı transaction'da alıcı satırının `sellerId`'sini boşaltır ve `sellerDeletedAt`
basar; FK `SetNull` güvenlik ağıdır. Alıcı satırı, mağaza adı snapshot'ı ve toplamlar korunur; ilerleme
"Hesap silindi" kovasını gösterir. Kullanıcı silindiğinde teslim kayıtları FK ile silindiğinden, silinmeden
önce gönderim tamamlanmışsa bu bilgi outbox satırından okunup "silinmeden önce gönderim tamamlanmıştı"
notuyla gösterilir. Silinmiş satıcı yeniden denemeye alınmaz.

## 11. Medya

| Konu | Karar |
|---|---|
| Klasör | `announcements` (herkese açık önek listesine eklendi). |
| Türler | JPEG, PNG, MP4, WebM. **WebP yok:** kapak e-postada gösterilir, Outlook WebP göstermez. |
| Boyut | Görsel ve kapak 10 MB; duyuru videosu 50 MB. Slider videosu 10 MB'da kaldı. |
| İmza kontrolü | Onay sırasında baytlar doğrulanır: PNG/JPEG imzası (+ en fazla 6000 px), MP4'te `ftyp`, WebM'de EBML + `webm`. Video için yalnız ilk 64 bayt okunur. Uymayan dosya reddedilir ve R2'den silinir. |
| Süre | Video süresi sunucuda ölçülmüyor (ffprobe yok); yalnız boyut ve tür doğrulanır. |
| Bağlama | Yalnız `ready`, `announcements` klasöründeki medya bağlanır; kapak yalnız video için, yalnız görsel olabilir. Taslağı başka bir admin de düzenleyebilir. |
| Silme sırası | `deleteAsset` artık önce DB satırını kilit altında siler, commit sonrası R2 nesnesini siler. Bağlama ile silme FK kilidiyle serileşir: bir tekrar "bağlı ama dosyası silinmiş" durumunda bitemez. R2 silme başarısız olursa yalnız öksüz nesne kalır ve loglanır. |
| CSRF | Admin medya `upload-url` ve `confirm` rotaları artık `checkCsrf` uygular; yükleyici `csrfFetch` ile çağırır ve R2 PUT ilerlemesi gösterir. |
| Oynatma | Video doğrudan medya host'undan oynatılır (Range desteği). Host yapılandırılmamışsa yalnız kapak gösterilir. |

**Yan etki (olumlu):** silme sırası değişikliği `deleteAsset`'i kullanan tüm yerleri etkiler. FK'si olmayan
ürün medyasında davranış değişmedi. Ana sayfa slider/promo'nun zorunlu medyası artık kendi FK'siyle korunuyor;
eskiden R2 dosyası önce silinip DB silmesi sonra reddediliyordu.

## 12. Satıcı paneli

- Menüde **Mağaza → Duyurular**; okunmamış rozeti müşteri soruları sayacıyla paralel hesaplanır.
  Askıdaki satıcı da duyuruları görür.
- `/duyurular`: 30'luk sayfalı liste, "Okunmadı" ve "Güncellendi" etiketleri, görsel/video simgesi.
- `/duyurular/[id]`: yalnız satıcıya ait alıcı satırı varsa açılır, yoksa "bulunamadı" arayüzü gösterilir.
  Metin düz yazı olarak gösterilir; görsel, ya da `controls playsInline preload="metadata" poster` ile video.
- **Okundu:** sunucu render'ı okundu işaretlemez. Sayfa görünür olduğunda istemci `POST
  /api/seller/announcements/{id}/read` gönderir (CSRF → IP limiti → oturum → aktif/askıdaki satıcı →
  kullanıcı limiti). Yalnız ilk görüntüleme yazılır; başka satıcının duyurusu 404 döner.

## 13. Olay kataloğu

| Tip | Alıcı | Hat | Gönderen | Tetik |
|---|---|---|---|---|
| `seller_announcement` | satıcı hesabının güncel e-postası | `bulk` | `noreply` | Dağıtım sweep'i alıcıyı outbox'a yazar |

Konu: `Hanuja Duyurusu: {başlık}` (120 karakterde kısalır). Gövde: başlık, selamlama, panele bağlı kapak
görseli (görselin kendisi ya da videonun kapağı), paragraflı metin, "Duyuruyu Görüntüle" / "Videoyu İzle"
butonu ve "operasyonel duyuru" dipnotu. Düz metin sürümü de üretilir.

## 14. Test kapsamı

| Dosya | Kapsam |
|---|---|
| `tests/unit/domain/announcement-audience.test.ts` | veya/ve, uygunluk, elle seçim, hariç tutma, profilsiz satıcı, +03:00, kategori alt ağacı ve döngü, aynı ilçe adı, hash |
| `tests/unit/domain/announcement-progress.test.ts` | yoklama aralığı, güvenli hata kodu |
| `tests/unit/email-templates-announcements.test.ts` | kaçış, paragraf, kapak/video, güvensiz URL, düz metin, konu kısaltma |
| `tests/unit/services/announcement.service.test.ts` | taslak çakışmaları, medya kuralları, P2003, silme, retry gerekçesi, satıcı sahipliği ve okundu |
| `tests/unit/services/announcement-content.test.ts` | kapak seçimi, donmuş içerik, video URL'si |
| `tests/unit/media-announcement-upload.service.test.ts` | 50/51 MB, slider 10 MB, WebP reddi, sahte imza, silme sırası |
| `tests/unit/media-signature.test.ts` | PNG/JPEG/MP4/WebM imzaları |
| `tests/unit/announcement-draft-save-state.test.ts` | kaydetme sürerken yapılan düzenleme kaydedilmemiş kalır; üst üste kaydetmeler sırayla ve dönen sürümle gider; başarısız kaydetme kuyruğu kilitlemez |
| `tests/security/announcement-routes.test.ts` | CSRF önce, yalnız admin, hash/version bağlama, gerekçe, rate limit, bozuk gövde 400, satıcı okundu rotası |
| `tests/postgres/announcement-send.test.ts` | gerçek veride filtreler; 5 eşzamanlı gönderim → tek dondurma; bayat liste/version → 409; 3 paralel sweep + 2.500 alıcı + 40 dolu slot → tam 60 yazım, alıcı başına tek outbox; kilitli satırda ~2 sn içinde geri alma; retry kapasite, belirsiz/silinmiş hariç, eşzamanlı istekte tek işaret; satıcı silinince geçmiş korunur; düzenleme yeni gönderim üretmez, dispatcher donmuş içeriği gönderir; bağlama ↔ silme 20 tekrar |

Güncellenen mevcut testler: dispatch job (donmuş başlık, rıza sorgulanmaz, satıcı olmayan hesaba gitmez),
outbox (bulk hat, toplu insert), r2 sınırları, medya silme sırası açıklaması.

Sonuçlar (2026-09-24, yerel):
- `pnpm lint` 7/7, `pnpm typecheck` 8/8, `pnpm build` 3/3 başarılı.
- `pnpm test` exit 0: 227 dosya, 2299 test geçti, 2 atlandı (kaydetme düzeltmesi sonrası).
- `pnpm --filter @hanuja/tests test:postgres` (iki test veritabanıyla): 6 dosya, 122 test geçti.

## 15. Yerel tarayıcı doğrulaması (2026-09-24)

Yerel admin (3002) ve satıcı (3001) paneli, worker boş SMTP değişkenleriyle çalıştırıldı (geliştirme JSON
transport'u; gerçek e-posta gönderilmedi).

- Yeni taslak → başlık/metin (HTML karakterleriyle) → elle seçimde "Test Magaza E2E" → kaydet (PATCH 200).
- Önizleme: kesin alıcı sayısı 1. E-posta önizlemesi `sandbox=""` iframe'de; başlık ve metin kaçışlı, `<script>` yok.
- Gönder onayında "1 satıcıya ayrı e-posta…" ve ortak kota uyarısı; gönderim 200, görünüm "Gönderilmiş duyuru"ya geçti.
- Worker: outbox satırı `bulk` hatta yazıldı ve `completed` oldu. E-posta `Hanuja Duyurusu: …` konusuyla test
  satıcısına gitti (geliştirme transport'u), in-app bildirim de gönderildi.
- İlerleme: "SMTP kabul etti (1)" (geliştirme transport'unda teslim webhook'u gelmez).
- Gönderim sonrası başlık düzenlendi: "Güncellendi" notu ve "E-postada giden metni göster" çıktı. Outbox 1, teslim
  kaydı 2, e-posta 1 olarak kaldı; iki denetim kaydı yazıldı.
- Satıcı paneli: listede güncel başlık, "Okunmadı" ve "Güncellendi"; menüde "Duyurular 1". Okundu rotası ilk
  çağrıda `advanced: true`, ikincide `false`, başka kimlikte 404; sonrasında rozet ve "Okunmadı" kalktı.
  Başka kimlikli detay sayfası "bulunamadı" arayüzünü gösterdi.
- Filtre: "İstanbul" → yalnız Atelier Noa. "Çıkar" → 0, "Geri al" → 1 (her ikisi de kaydedip önizledi).
  Taslak silindi ve listeye dönüldü.

- **Gecikmeli kaydetme (inceleme bulgusu, düzeltildi):** sayfadaki `fetch` PATCH'i 4 sn geciktirecek şekilde
  sarıldı. "Eski metin" kaydedilirken başlığa " + yeni ek" yazıldı. Yanıt gelince ekran "Kaydedildi; sonraki
  değişiklikler henüz kaydedilmedi." gösterdi, "Taslağı kaydet" etkin, "Gönder" kapalı kaldı; sunucuya yalnız
  "Eski metin" gitmişti. İkinci kaydetme yeni metni dönen sürümle gönderdi (409 yok); veritabanında başlık
  "Eski metin + yeni ek", sürüm 3. Önceki sürümde yanıt yeni düzenlemeyi de "kaydedildi" sayıyor ve gönderimi
  açabiliyordu.

Yerelde doğrulanamayanlar:
- **Medya yükleme ve video oynatma.** Yerel ortam gerçek bir R2 bucket'ına bağlı olduğu için dosya
  yüklenmedi; canlı doğrulamaya kaldı.
- **Okundu bileşeninin otomatik tetiklenmesi.** Gizli tarayıcı paneli çizim yapmadığı için
  `requestAnimationFrame` tetiklenmiyor (bkz. üretim hazırlığı §25); rota ve servis doğrudan çağrıyla
  doğrulandı. Bileşen Faz 4'te canlıda doğrulanmış okundu kalıbının aynısıdır.

## 16. Bilinen sınırlar ve kapsam dışı

- Medyada gerçek erişim kontrolü (Cloudflare yol allowlist'i + imzalı GET) ayrı iş. Allowlist uygulandığında
  `announcements/` öneki izinli listeye eklenmelidir, yoksa videolar oynamaz.
- Diğer CSRF'siz admin mutasyon rotaları bilinen ayrı güvenlik işidir; bu fazda yalnız iki medya rotası sıkılaştı.
- Video süre ölçümü ve transcoding yok.
- Zamanlanmış duyuru ve müşteriye kampanya kapsam dışı.
- Kampanya indirimi üreticileri toplu hat kapasitesine bağlı değil.
- Sunucu render'ında `notFound()` akış başladıktan sonra çağrıldığı için sayfa HTTP 200 ile "bulunamadı"
  arayüzü döner; Faz 4 detay sayfasıyla aynı davranış. API rotası 404 döner.

## 17. Deploy

- Migration yalnız ekleme yapar ve ödemelere dokunmaz; `check-duplicate-payments` gerekmez.
- Sıra: `pnpm db:migrate:deploy` → **worker → admin-panel → seller-panel → web**.
  - Worker önce gitmeli: yeni `announcement-dispatch` kuyruğu ve `seller_announcement` şablonu worker'da.
    Eski worker bu tipi `EMAIL_TEMPLATE_UNSUPPORTED` ile düşürür.
  - Web, medya proxy allowlist'i ve ortak medya servisi için dağıtılır; kritik değil.
- Yeni ortam değişkeni yok.
