# Çerez Aydınlatması ve Rıza Sistemi — Çalışma Notu

Son güncelleme: 2026-09-28 · Çerez metni sürümü: `2026-09-28-v1`
Durum: yayın öncesi. Tablo yerel denetimle ve 2026-09-28 canlı denetimle (aşağıda) doğrulandı.

## Dayanak

- KVKK Kurumu, *Çerez Uygulamaları Hakkında Rehber* (2022): kesinlikle gerekli çerezler açık rızaya
  tabi değildir, ama aydınlatma her çerez için gerekir. Rıza gerektiren kategoriler varsayılan olarak
  kapalıdır. "Kabul", "Reddet" ve "Tercihler" eşit görünürlükte sunulur. Çerez duvarı kurulmaz;
  sayfada gezinmek ya da kaydırmak rıza sayılmaz.
- KVKK Kurulu 18.02.2026 tarihli, 2026/347 sayılı İlke Kararı (RG 24.03.2026): aydınlatma metni için
  onay alınmaz. Açık rıza gerekiyorsa aydınlatmadan ayrı kurulur.

Bu yüzden bilgilendirmedeki "Anladım" butonu rıza değildir. Sunucuya gitmez ve yalnız tarayıcıda
metin sürümünü saklar.

## Tek kaynak

| Dosya | Görev |
|---|---|
| `api/lib/cookie-policy.ts` | Envanter, kategoriler, `COOKIE_POLICY_VERSION`, parmak izi, mod, beklenen dış hostlar |
| `apps/web/src/lib/cookie-consent/scripts.ts` | Rızaya bağlı script kaydı (bugün boş) |
| `apps/web/src/lib/cookie-consent/browser.ts` | Tarayıcı depolamasına ve `document.cookie`'ye yazan tek dosya |
| `apps/web/src/components/cookie-consent/*` | Bildirim (tasarım C, "küçük baloncuk"), tercih paneli, footer düğmesi |
| `api/services/cookie-consent.service.ts` + `POST /api/cookie-consent` | Rıza ispat kaydı |
| `/cerez-politikasi`, `/kvkk` | Kamuya açık metinler (iş sahibinin verdiği metin, birebir) |

`/cerez-politikasi` tablosu `getBaseCookieInventory()`'den üretilir; elle yazılmaz.

## Mod kuralı

- **Bilgilendirme modu (bugün):** envanterdeki her kalem `necessary`. Altta küçük bir hap
  gösterilir: "Yalnızca zorunlu çerezler kullanıyoruz · Ayrıntılar" ve "Anladım". Rıza sorulmaz ve
  `POST /api/cookie-consent` 409 (`CONSENT_NOT_REQUIRED`) döner.
- **Rıza modu:** envantere zorunlu olmayan ilk kalem eklendiği anda kendiliğinden açılır.
  - Kutuda "Kabul et / Reddet / Yönet" butonları aynı renk ve boyuttadır. Erişilebilir adları
    "Tümünü kabul et / reddet / Tercihleri yönet"tir.
  - Tercih panelinde dört kategori her zaman listelenir. Çerezi olmayan kategori kapalı ve kilitli
    görünür.
- Footer'daki "Çerez Tercihleri" düğmesi paneli her iki modda da açar.

## Rıza modunun davranışı

- **İlk paint:** SSR'da ve ilk client render'da hiçbir isteğe bağlı script yoktur. Karar,
  hydration'dan sonra localStorage'dan okunur. Okunamayan, bozuk ya da eski sürüm karar "karar yok"
  sayılır.
- **Script yükleme:** script yalnız kategori izni kaydedildikten sonra
  `document.createElement('script')` ile eklenir. Önce yükleyip sonra engelleme yapılmaz.
- **Fail-closed:** izin içeren bir karar sunucuya kaydedilemezse uygulanmaz ve kutuda hata
  gösterilir. Ret her durumda yerelde uygulanır.
- **Geri alma:**
  - İlgili script'in `cleanup` listesindeki çerezler (host ve üst alan adı) ve depolama anahtarları
    silinir.
  - O sayfada çalışmış bir script varsa sayfa yeniden yüklenir, böylece sonraki gezinmelerde
    çalışmaz.
  - Sağlayıcıya özel temizlik gerekiyorsa script kaydına eklenir.
- **Sunucu kaydı** (`cookie_consent_records`):
  - Kayıtlar yalnız eklenir. Aynı tarayıcının kararları `consentId` altında zincirlenir.
  - `userId` yalnız sunucu oturumundan alınır. IP ve tarayıcı bilgisi saklanmaz; IP yalnız
    Redis'teki rate-limit anahtarında geçicidir.
  - Kabul ve ret bayrakları butondan türetilir. Envanterde karşılığı olmayan kategori her zaman
    `false` yazılır.
  - Bilinmeyen `consentId` benimsenmez, yerine yenisi üretilir.
  - Aynı sürümde verilmiş bir izni kapatmak `withdraw` olarak kaydedilir.

## Sürüm kuralı

Envanterdeki herhangi bir değişiklik `COOKIE_POLICY_FINGERPRINT`'i bozar. Bu durumda
`tests/unit/cookie-policy.test.ts`, `COOKIE_POLICY_VERSION` yükseltilene kadar kırılır. Yeni sürüm
bilgilendirmeyi yeniden gösterir ve eski rızayı geçersiz sayar. Yeni kategori, amaç ya da sağlayıcı
yeni rıza gerektirebilir. Sürüm yükseltilirken `COOKIE_POLICY_UPDATED_AT` da güncellenir.

## Zorunlu olmayan bir araç (analitik, piksel, chat vb.) eklemeden önce

1. Aracın koyduğu çerez ve depolama adlarını `pnpm cookie:audit` ile gerçek tarayıcıda tespit et.
   Tahmini ad yazma.
2. Tespit edilen adları `COOKIE_INVENTORY`'ye doğru kategoriyle ve `KVKK m.5/1 (açık rıza)`
   hukuki sebebiyle ekle. Sürümü ve parmak izini güncelle.
3. Script'i `CONSENT_SCRIPTS`'e ekle. `cleanup` listesine aracın çerezlerini ve anahtarlarını yaz.
4. `tests/security/client-tracking-guard.test.ts` izin listesini gerekçesiyle güncelle.
5. Yurt dışı aktarım varsa KVKK m.9 mekanizmasını hukukla netleştir.
6. Rıza modu e2e testlerini koş (aşağıda).

## Denetim aracı

```bash
pnpm cookie:audit
```

- **Ne yapar:** temiz bir Chromium profiliyle sayfaları gezer (ürün sayfası listeden bulunur).
  Çerezleri, localStorage/sessionStorage/IndexedDB anahtarlarını, `Set-Cookie` başlıklarını ve dış
  hostları envanterle karşılaştırır. Envanterde olmayan birinci taraf ad, üçüncü taraf çerez ya da
  beklenmeyen host bulursa `exit 1` verir.
- **Rapor:** `outputs/cookie-audit-<host>-<zaman>.json`.
- **`--login`:** yalnız localhost'ta çalışır. `COOKIE_AUDIT_EMAIL` / `COOKIE_AUDIT_PASSWORD` gerekir
  ve Turnstile dev bypass'ını kullanır.
- **`--google`:** Google butonuna tıklar; Google'a yönlendirme engellenir.
- **`--base-url=https://www.hanuja.com.tr`:** yalnız herkese açık sayfalar, giriş yapılmaz.
- Git Bash'te `--pages` değerlerini başında `/` olmadan verin (`--pages=urunler,giris`).

**2026-09-28 yerel sonuç:**
- Girişsiz: `hanuja-csrf` ve `hanuja-csrf-mirror`, 24 saat.
- Girişten sonra: `better-auth.session_token` (30 gün) ve `better-auth.session_data` (5 dk).
- localStorage/sessionStorage/IndexedDB boş; dış istek yok.
- `better-auth.state` yerelde gözlenemedi çünkü Google girişi yerelde kapalı. Better Auth 1.6.25
  kaynağından eklendi (`state.mjs`, 5 dk).

## Canlı denetim (deploy öncesi, kullanıcıyla birlikte)

```bash
pnpm cookie:audit --base-url=https://www.hanuja.com.tr --google
```

Kesinleşecekler:
- `__Secure-` önekli adlar.
- `better-auth.state`.
- Cloudflare Turnstile'ın (`challenges.cloudflare.com`) ya da `media.hanuja.tr` CDN'inin çerez
  koyup koymadığı (örneğin `__cf_bm`).

Üçüncü taraf bir çerez görülürse envantere gerçek adıyla eklenir ve sürüm yükseltilir.

**2026-09-28 canlı sonuç** (deploy öncesi, kullanıcıyla birlikte, Chromium, girişsiz):

- Çerezler: `hanuja-csrf` ve `hanuja-csrf-mirror` (24 saat, Secure), `__Secure-better-auth.state`
  (5 dk, yalnız Google tıklamasında). Hepsi envanterde.
- Üçüncü taraf çerez yok. Turnstile (`challenges.cloudflare.com`) ve `media.hanuja.tr` hiç çerez
  koymadı. localStorage, sessionStorage ve IndexedDB boş.
- Dış hostlar:
  - `media.hanuja.tr`
  - `challenges.cloudflare.com` ve `brunhild.challenges.cloudflare.com` (Turnstile alt alan adı;
    `*.challenges.cloudflare.com` olarak beklenen listeye eklendi)
  - `accounts.google.com` (yalnız Google tıklaması, engellendi)
- Oturum çerezleri canlıda girişsiz gözlenemez. Yerelde doğrulandı; canlıda `__Secure-` önekiyle
  yazılır (`state` çerezinde görüldüğü gibi).

## E2E

- **Dosya:** `tests/e2e/storefront/cookie-consent.e2e.ts`. Storefront projesinde webServer yok; dev
  sunucusu elle başlatılır.
- **Bilgilendirme modu:** senaryolar A, B, G, I, J, K, M.

  ```bash
  pnpm exec playwright test -c tests/e2e/playwright.config.ts --project=storefront cookie-consent
  ```

- **Rıza modu:** senaryolar C, D, E, F, G, H, I, J, K, L, M.
  `NEXT_PUBLIC_COOKIE_CONSENT_E2E_FIXTURE=1` hem dev sunucusuna hem test komutuna verilir.
  Fikstür script'leri `page.route` ile sunulur.
  - Bu değişken production'da **asla** set edilmez. `pnpm check-env --env=prod` set edilirse hata
    verir.
- **2026-09-28 yerel sonuç:** iki modda da 5/5 geçti.
- CI'daki e2e işi fiilen koşmuyor (`apps/web`'de `test:e2e` script'i yok, iş yalnız main/PR'da
  çalışıyor). Bu testler yerelde koşulur.

## Açık konular (hukuki inceleme)

- **Hukuki sebep sütunu** (m.5/2-c, m.5/2-f, m.5/2-ç) Claude'un önerisidir; hukukçu teyidi gerekir.
- **Cloudflare Turnstile:** Cloudflare kalıcı çerez koymadığını beyan ediyor. Ancak IP,
  User-Agent ve TLS sinyali ABD'li sağlayıcıya gider; bu KVKK m.9 kapsamında değerlendirilmeli.
  `media.hanuja.tr` üzerinden görsel istekleri de Cloudflare'e gider.
- **Google ile giriş:** kullanıcı Google'a yönlendirildiğinde Google kendi alan adındaki çerezlerden
  sorumludur. Google'dan alınan ad ve e-posta için aydınlatma ve yurt dışı aktarım değerlendirilmeli.
- **Iyzico / banka 3D Secure:** kartla ödemede sayfa Iyzico/banka sayfasına geçer; o sayfalardaki
  çerezler ilgili kuruluşa aittir. Denetim aracı bu sayfaları ziyaret edemez.
- **Rıza kayıtlarının saklama süresi** belirlenmedi. Budama yok; iş ve hukuk kararı gerekli.
- **KVKK metni** §2 "risk puanları" ve §8 "Otomatik Risk ve Güvenlik Kontrolleri" bölümleri iş sahibi
  kararıyla aynen yayında. Kodda `scoreOrderRisk` (`packages/security/src/fraud-scorer.ts`) bugün
  hiçbir yerden çağrılmıyor.
- **Diğer hukuki sayfalar** (gizlilik, kullanım koşulları, sözleşmeler) kısaltılmış unvanı
  (`companyNameDisplay`) kullanmaya devam ediyor. Yeni iki metin tam unvanı (`companyLegalName`)
  kullanıyor.
- **Kapsam:** satıcı ve admin panelleri de çerez kullanıyor; bu iş yalnız mağazayı (`apps/web`)
  kapsıyor.
