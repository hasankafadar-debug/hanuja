# Son güncelleme: 2026-07-03
# Durum: taslak v1

# Production Deploy Runbook

Kaynak dosyalar (bu doküman onlarla çelişmez, üzerlerine ek sıralı runbook sağlar):
- `docs/06-engineering/deployment-environments.md` — ortamların genel mimarisi (local/staging/production, servis listesi, rollback)
- `docs/06-engineering/coolify-setup.md` — Coolify servis bazlı env değişkeni tablosu, DNS, checklist
- `.claude/rules/12-production-readiness.md` — kalan gerçek boşluklar, worker/migration notları
- `tools/scripts/check-env.ts` — ortam değişkeni gereksinim listesinin tek kaynağı

Bu doküman, ilk canlıya çıkış için **sıralı adımları** ve özellikle **Iyzico sandbox → live geçişini** ve **migration guard script'ini** kapsar. Servis bazlı env değeri tablosu veya genel mimari için yukarıdaki dosyalara bakın — burada tekrar edilmez.

---

## 1. Sunucu ve Coolify Kurulumu (manuel, ops sorumluluğu)

Bu adım otomatikleştirilemez; bu doküman sadece hatırlatma listesi sağlar. Detaylar için `docs/06-engineering/coolify-setup.md`.

- [ ] VDS/sunucu tedarik edilmiş (öneri: 8GB+ RAM, 4 vCPU+ — dört Next.js servisi + worker + Postgres + Redis + Meilisearch aynı makinede/ağda çalışacaksa bu asgari düzeydir; büyüme planına göre artırın)
- [ ] Coolify sunucuya kurulmuş ve erişilebilir
- [ ] Domain/DNS kayıtları `docs/06-engineering/coolify-setup.md` §"DNS / Domain Setup" tablosuna göre ayarlanmış (`hanuja.com`, `seller.hanuja.com`, `admin.hanuja.com`, `media.hanuja.com`)
- [ ] Coolify'da her servis için Let's Encrypt üzerinden SSL/HTTPS sertifikası provision edilmiş
- [ ] PostgreSQL 16 servisi Coolify üzerinde (veya yönetilen ayrı bir servis olarak) provision edilmiş — CLAUDE.md §"Redis ve PostgreSQL ayrı yönetilen servisler olmalı" kuralına göre uygulama container'ının İÇİNDE DEĞİL
- [ ] Redis 7 servisi ayrı yönetilen servis olarak provision edilmiş
- [ ] Meilisearch servisi provision edilmiş
- [ ] Coolify Git kaynak bağlantısı yapılmış, default branch `main` olarak ayarlanmış (bkz. `docs/06-engineering/coolify-setup.md` §"Repository Connection")

Bu adım tamamlanmadan sonraki adımlara geçilmez.

---

## 2. Ortam Değişkenleri

Gerekli/opsiyonel değişkenlerin tek doğru kaynağı `tools/scripts/check-env.ts` dosyasındaki `ENV_VARS` listesidir. Aşağıdaki liste o dosyadan alınmıştır (2026-07-03 itibarıyla) — dosya değişirse bu liste değil, dosya esastır.

### Zorunlu (`required: true`)
| Değişken | Açıklama |
|---|---|
| `DATABASE_URL` | PostgreSQL bağlantı string'i |
| `REDIS_URL` | BullMQ için Redis bağlantı URL'i |
| `BETTER_AUTH_SECRET` | Better Auth imzalama secret'ı (min 32 karakter) |
| `BETTER_AUTH_URL` | Auth base URL (web app URL) |
| `NEXT_PUBLIC_APP_URL` | Public web app URL |
| `SELLER_PANEL_URL` | Seller panel base URL |
| `ADMIN_PANEL_URL` | Admin panel base URL |
| `IYZICO_API_KEY` | Iyzico API key |
| `IYZICO_SECRET_KEY` | Iyzico secret key |
| `IYZICO_BASE_URL` | Iyzico base URL (sandbox veya live) |
| `IYZICO_WEBHOOK_SECRET` | Iyzico webhook HMAC secret |
| `R2_ACCOUNT_ID` | Cloudflare R2 hesap ID |
| `R2_ACCESS_KEY_ID` | R2 access key |
| `R2_SECRET_ACCESS_KEY` | R2 secret access key |
| `R2_BUCKET_NAME` | R2 bucket adı |
| `R2_PUBLIC_URL` | R2 public CDN URL |
| `MEILISEARCH_URL` | Meilisearch sunucu URL |
| `MEILISEARCH_ADMIN_KEY` | Meilisearch admin API key |
| `MEILISEARCH_SEARCH_KEY` | Meilisearch public search key |

### Production'da zorunlu (`requiredInProd: true`)
| Değişken | Açıklama |
|---|---|
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Cloudflare Turnstile site key |
| `TURNSTILE_SECRET_KEY` | Cloudflare Turnstile secret key (dev bypass token kabul edilmez) |
| `INBOUND_EMAIL_DOMAIN` | Gelen fatura e-posta domaini (örn. `fatura.hanuja.tr`) |
| `POSTMARK_INBOUND_WEBHOOK_USER` | Postmark inbound webhook basic auth kullanıcı |
| `POSTMARK_INBOUND_WEBHOOK_PASS` | Postmark inbound webhook basic auth şifre |

### Opsiyonel
`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `INVOICE_ALIASING_ENABLED`, `NEXT_PUBLIC_SITE_NAME`, `NEXT_PUBLIC_SITE_URL`, `AUTO_APPROVE_CLEAN_PRODUCTS` (bkz. `.claude/rules/12-production-readiness.md` §6 — varsayılan `false` kalmalı).

### Doğrulama
Tüm değişkenler Coolify panelinden her servise ayrı ayrı girilir — **hiçbir zaman repo'ya commit edilmez** (bkz. `.claude/rules/05-security-rules.md` §"Secret ve Credential Kuralları"). Servis bazlı hangi değişkenin hangi Coolify servisine gireceği için `docs/06-engineering/coolify-setup.md` tablolarını kullanın.

```bash
pnpm check-env --env=prod
```

Bu komut **YEŞİL (exit 0)** dönmeden deploy'a devam edilmez. Placeholder değer tespit edilirse (`your-`, `changeme`, `example.com` gibi kalıplar) `sensitiveInProd` işaretli değişkenler için FAIL üretir.

---

## 3. Iyzico Anahtar Stratejisi (öneri)

> Bu bölüm bir öneridir, kesin kural değildir — nihai karar ops/iş kararına bağlıdır.

### 3.1 İlk deploy — sandbox anahtarları
İlk production deploy'da **Iyzico SANDBOX anahtarlarının** kullanılması önerilir:

| Değişken | İlk deploy değeri |
|---|---|
| `IYZICO_BASE_URL` | `https://sandbox-api.iyzipay.com` |
| `IYZICO_API_KEY` | sandbox key |
| `IYZICO_SECRET_KEY` | sandbox secret |

Gerekçe: Iyzico canlı siteyi incelerken (başvuru/onay süreci) gerçek para hareketi olmaması istenir. Sandbox anahtarlarıyla checkout akışı uçtan uca çalışır durumda gösterilebilir, ancak gerçek kart tahsilatı yapılmaz.

**Kritik kural** (`.claude/rules/00-project-scope.md`, `CLAUDE.md`): Iyzico sandbox kimlik bilgileri **asla** production'a sızmamalı — ama burada durum tersi: ilk production deploy'unun BİZZAT SANDBOX kullanması geçici ve bilinçli bir karardır, Iyzico onayı sonrası mutlaka live'a geçilmelidir. Sandbox anahtarlarıyla production'da kalış süresi belirsiz/kalıcı olmamalıdır.

### 3.2 Iyzico onayından sonra — live anahtarlara geçiş

Iyzico incelemeyi tamamlayıp live API anahtarlarını teslim ettiğinde:

1. Coolify panelinde **her ilgili servis** için (`web`, `worker` — bkz. `docs/06-engineering/coolify-setup.md` §"Service 4: worker" notu: worker Iyzico credential'ına ihtiyaç duymaz, sadece `web` API route'ları kullanır) aşağıdaki değişkenleri live değerlerle güncelleyin:
   - `IYZICO_API_KEY` → live key
   - `IYZICO_SECRET_KEY` → live secret
   - `IYZICO_BASE_URL` → `https://api.iyzipay.com`
   - `IYZICO_WEBHOOK_SECRET` → Iyzico live webhook ayarlarından alınan yeni secret
2. Iyzico dashboard'da live webhook URL'ini `https://hanuja.com/api/webhooks/iyzico` (veya ilgili route) olarak kayıt edin.
3. `pnpm check-env --env=prod` tekrar çalıştırılıp placeholder/sandbox kalıntısı olmadığı doğrulanmalı.
4. Servisi yeniden deploy edin (env değişikliği Coolify'da yeni bir deploy tetikler).
5. Küçük tutarlı gerçek bir kart işlemiyle (varsa) veya Iyzico'nun sağladığı doğrulama akışıyla live bağlantı test edilmeli.
6. `docs/05-security/payment-security.md` §7'deki tutar eşitliği ve `providerPaymentId` tekrar kullanım kontrollerinin live ortamda da aktif olduğu (kod değişmediği için otomatik olarak aktiftir, ama doğrulanmalı) teyit edilmeli.

Asla: sandbox anahtarlarını live ile karıştırmayın, local/staging'i live anahtarlarla yapılandırmayın (bkz. `.claude/rules/05-security-rules.md` §"Environment Separation Rules").

---

## 4. Migration Sırası

`docs/06-engineering/deployment-environments.md` §"Migration Strategy"/"Deploy Order" kuralı: **migration'lar yeni app kodu canlıya çıkmadan ÖNCE çalışır.** Production'da sadece `prisma migrate deploy` kullanılır — asla `migrate dev` veya `migrate reset` değil.

Sıra:

1. **Duplicate providerPaymentId guard** — production `DATABASE_URL`'e karşı çalıştırılır:
   ```bash
   pnpm check-duplicate-payments
   ```
   Bu komut `tools/scripts/check-duplicate-provider-payment-ids.ts` script'ini çalıştırır. Bu, migration `20260703100000_payment_provider_payment_id_unique`'in production'da güvenle uygulanabileceğini doğrulayan **manuel/pipeline-özel** bir adımdır — genel `pnpm release-check` zincirinin parçası DEĞİLDİR (`release-check` dev/CI veritabanına karşı çalışır, bu script ise sadece hedef/production DB'sine karşı anlamlıdır). Bkz `.claude/rules/12-production-readiness.md` §16.

   - Çıktı `OK — duplicate providerPaymentId bulunamadı...` ve exit 0 ise → adım 2'ye geçin.
   - Çıktı FAIL ve exit 1 ise (duplicate bulundu VEYA DB'ye bağlanılamadı) → **DURDURUN**. Duplicate bulunduysa script ilgili `payment.id`/`orderId` listesini basar; bu kayıtlar elle mutabakat yapılmadan migration çalıştırılmaz. Bağlantı hatası varsa önce bağlantıyı düzeltin — script "bilmiyorum" durumunda fail-closed davranır, asla sessizce geçmez.

2. Guard script temiz (exit 0) döndükten sonra:
   ```bash
   pnpm db:migrate:deploy
   ```
   (bu, `pnpm --filter @hanuja/db exec prisma migrate deploy` çalıştırır — bkz. root `package.json`)

3. Migration başarısız olursa deploy **durur** — kısmi deploy yapılmaz (`docs/06-engineering/deployment-environments.md` §"Migration Strategy", `.claude/rules/11-testing-release-rules.md` "Strong release blockers" — bilinen kırık payment/payout/penalty davranışıyla release yapılmaz kuralının migration adımına uygulanması). Yeni app kodu migration tamamlanmadan hiçbir servise deploy edilmez.

---

## 5. Dört Servisin Deploy'u

Servis tanımları ve Dockerfile eşlemesi için `docs/06-engineering/deployment-environments.md` §"Production / Staging (Coolify)" tablosuna bakın:

| Servis | Dockerfile | Port |
|---|---|---|
| web | `Dockerfile.web` | 3000 |
| seller-panel | `Dockerfile.seller-panel` | 3001 |
| admin-panel | `Dockerfile.admin-panel` | 3002 |
| worker | `Dockerfile.worker` | — (HTTP portu yok) |

Önerilen deploy sırası (`docs/06-engineering/deployment-environments.md` §"Deploy Order" ile birebir):

1. Migration (Bölüm 4 tamamlanmış olmalı)
2. **worker** — güncel job mantığı önce ayakta olmalı (özellikle ceza birikimi/payout olgunlaşma job'ları için — bkz. Bölüm 6)
3. **admin-panel**
4. **seller-panel**
5. **web** — en yüksek trafikli servis, en son deploy edilir

Build doğrulaması her servis deploy'undan önce CI'da veya lokal olarak tamamlanmış olmalı: `pnpm build` ve `pnpm typecheck` yeşil olmadan deploy başlatılmaz (`.claude/rules/11-testing-release-rules.md` §"Release Gate Rules").

---

## 6. Worker Doğrulaması (kritik)

`.claude/rules/12-production-readiness.md` §9 uyarınca: `fulfillment-risk` BullMQ worker'ı günlük %1 geç sevkiyat ceza birikimini ve 20. gün auto-cancel'ı işler; worker çalışmıyorsa **ceza birikimi durur** ve payout olgunlaşma (30 günlük hold sonrası) işlenmez.

Worker deploy sonrası doğrulama adımları:

- [ ] Coolify'da `worker` servisinin durumu "running" / "healthy" (restart policy: `unless-stopped` — bkz. `docs/06-engineering/coolify-setup.md`)
- [ ] Worker logları aktif ve hata döngüsünde değil (sürekli crash-restart yok)
- [ ] BullMQ kuyruk durumu incelenmiş — Redis üzerinden bekleyen/başarısız job sayısı makul seviyede (worker'ın HTTP health endpoint'i yok; sağlık Redis/BullMQ kuyruk durumu üzerinden izlenir — bkz. `docs/06-engineering/deployment-environments.md` §"Health Checks")
- [ ] `schedule-repeatable-jobs` (bkz. `api/jobs/schedule-repeatable-jobs.ts`) ilk worker açılışında tekrarlanan job'ları (fulfillment-risk, payout maturity, vb.) doğru şekilde kaydetmiş

Worker doğrulanmadan production "tamamlandı" olarak işaretlenmez.

---

## 7. Smoke Test (Golden Path)

Deploy sonrası, production URL'lerine karşı aşağıdaki akışlar en az bir kez manuel doğrulanmalı. Otomatik referans senaryolar için:
- `tests/e2e/customer-flow.spec.ts`
- `tests/e2e/customer-eft-flow.spec.ts`

Bu testler yerel/CI ortamı için yazılmıştır; production URL'ine karşı otomatik çalıştırılması **zorunlu değildir**, ama istenirse aynı adımlar `BASE_URL` production'a işaret edecek şekilde elle veya Playwright ile tekrarlanabilir (dikkat: production'da gerçek sipariş/veri oluşturur, test verisi temizliği gerekir).

Minimum manuel smoke test kapsamı:

- [ ] **Müşteri**: kayıt ol → ürün gör → sepete ekle → checkout (kart, sandbox veya live'a uygun test kartı) → sipariş onayı görüntülenir
- [ ] **Müşteri**: EFT akışı → banka hesabı seçimi → sipariş oluşur (bkz. `customer-eft-flow.spec.ts` adımları: statik yasal sayfalar, sözleşme onayı, sipariş listesi görünürlüğü)
- [ ] **Satıcı**: giriş yap → paid order seller panelde görünür (unpaid sipariş GÖRÜNMEMELİ — `.claude/rules/09-seller-panel-rules.md`)
- [ ] **Admin**: giriş yap → payout ekranı açılır, veri yükleniyor, hata vermiyor
- [ ] Üç uygulamanın health endpoint'i yanıt veriyor: `/api/health` (web, seller-panel, admin-panel — bkz. `docs/06-engineering/deployment-environments.md` §"Health Checks", interval 30s / timeout 5s)

Smoke test başarısız olursa deploy'u tamamlanmış saymayın; Bölüm 9'daki rollback yaklaşımını değerlendirin.

---

## 8. Iyzico İncelemesi İçin Hazırlık

> **Not:** Aşağıdaki liste genel pratik/beklenti özetidir — Iyzico'nun **kesin** başvuru/onay şartlarını bu doküman garanti etmez. Kesin gereksinim listesi için Iyzico ile doğrudan teyit edin.

Genelde beklenen hazırlık noktaları:

- [ ] Site HTTPS/SSL üzerinden erişilebilir (Bölüm 1'de tamamlanmış olmalı)
- [ ] Yasal sayfalar sitede canlı ve erişilebilir — `docs/08-legal/` altındaki taslaklara karşılık gelen yayın sayfaları:
  - Mesafeli satış sözleşmesi (`docs/08-legal/distance-sales-notes.md` taslağına dayalı yayın sayfası)
  - KVKK aydınlatma metni (`docs/08-legal/kvkk-notes.md`)
  - İade/iptal politikası (`docs/08-legal/return-cancellation-outline.md`)
  - Kullanım/üyelik şartları (`docs/08-legal/marketplace-terms-outline.md`)
  - Satıcı sözleşmesi ayrı bir akışta imzalatılır (`docs/08-legal/hanuja-satici-pazaryeri-sozlesmesi.md` — bu müşteri karşısında değil satıcı onboarding'inde görünür)
  - **Önemli**: `docs/08-legal/hanuja-satici-pazaryeri-sozlesmesi.md` dosyasının kendisi "imzaya hazır taslak — yayına alınmadan önce avukat ve mali müşavir kontrolü gerekir" notuyla işaretli. Bu kontrol tamamlanmadan yasal sayfalar nihai/imzalı kabul edilmemeli.
- [ ] Çalışan bir checkout akışı canlıda gösterilebilir durumda (Bölüm 3.1 — sandbox anahtarlarla)
- [ ] Şirket/iletişim bilgileri (adres, vergi no, müşteri hizmetleri iletişim) sitede görünür
- [ ] Marka/mağaza adı, iş modeli açıklaması (merkezi tahsilat modeli — CLAUDE.md §2.1) tutarlı şekilde sunulmuş

Bu liste tamamlandıktan sonra Iyzico başvurusu yapılır. Onay ve live anahtar teslimatından sonra Bölüm 3.2'ye dönün.

---

## 9. Rollback Notu

- **Migration `20260703100000_payment_provider_payment_id_unique`**: additive bir migration'dır (yalnızca UNIQUE INDEX ekler, veri kaybı riski yoktur). Guard script (Bölüm 4, adım 1) önceden temiz sonuç verdiyse migration'ın başarısız olma ihtimali düşüktür. Migration geri alınması gerekirse (`DROP INDEX "payments_providerPaymentId_key"`) veri kaybı olmadan yapılabilir — ancak bu, replay koruma açığını yeniden açar, bu yüzden sadece geçici bir acil durum adımı olarak düşünülmeli, kalıcı çözüm değil.
- **Genel migration geçmişi**: Bu repodaki checkpoint commit'leri (`checkpoint:` prefix'li) ve migration'lar additive olacak şekilde tasarlanmıştır (bkz. `db/schema/migrations/` altındaki dosya isimlendirmesi — kolon drop/tip değişikliği yerine yeni kolon/tablo ekleme eğilimi). Additive migration'lar için app rollback'i (önceki Coolify deploy'una dönmek), DB restore gerektirmeden güvenlidir (`docs/06-engineering/deployment-environments.md` §"Rollback" ile tutarlı).
- **Destructive migration varsa** (kolon drop, tip değişikliği): rollback öncesi PostgreSQL yedeğinden restore zorunludur. Bu runbook'un kapsadığı ilk deploy migration zincirinde (Bölüm 4) bilinen bir destructive migration yoktur; ileride destructive bir migration eklenirse bu bölüm güncellenmelidir (`.claude/rules/11-testing-release-rules.md` §"Rollback and Recovery Rules").
- **Deploy sırası nedeniyle güvenle tekrarlanabilir (idempotent) adımlar**:
  - `pnpm check-duplicate-payments` — salt okunur, birden fazla kez çalıştırılabilir
  - `pnpm check-env --env=prod` — salt okunur
  - `pnpm db:migrate:deploy` — Prisma migration'ları idempotent'tir (zaten uygulanmış migration'ı tekrar uygulamaz)
  - Worker/servis deploy'ları — Coolify'ın kendi deploy mekanizması yeniden denemeye uygundur
- **Güvenle tekrarlanamayacak / dikkat gerektiren adımlar**:
  - Iyzico live anahtar geçişi sonrası gerçek kart testi (gerçek para hareketi olabilir — küçük tutar kullanın)
  - Smoke test sırasında oluşturulan production sipariş kayıtları (test verisi temizliği ayrı bir adım gerektirir, otomatik silinmez)

Deploy başarısız olur ve migration adımı (Bölüm 4) tamamlanmadıysa: hiçbir yeni app kodu deploy edilmemiş olmalı (CLAUDE.md §7.2 — migration'lar app kodundan önce çalışır kuralının doğrudan sonucu budur). Migration adımı tamamlanmış ama sonraki servis deploy'larından biri başarısız olursa: additive migration'lar geriye dönük uyumlu olduğundan önceki app versiyonu (rollback) yeni migration ile birlikte çalışmaya devam edebilir — ancak bu her migration için ayrıca doğrulanmalıdır, varsayılan olarak garanti edilmez.

---

## Operasyonel Not

Bu runbook üç panel + worker'ı kapsayan ilk production deploy için yazılmıştır. Sonraki deploy'larda Bölüm 1 (sunucu/Coolify kurulumu) ve Bölüm 8 (Iyzico başvuru hazırlığı) genellikle tekrarlanmaz — Bölüm 2-7 ve 9 her deploy'da geçerlidir.
