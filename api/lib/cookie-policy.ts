/**
 * Cookie and browser-storage inventory — single source of truth for the storefront
 * cookie notice, the preferences dialog, /cerez-politikasi and POST /api/cookie-consent.
 *
 * Rules (docs/08-legal/cookie-policy-notes.md):
 *   - Only names that the running site actually sets belong here. Never add a guessed name.
 *     `pnpm cookie:audit` compares a real browser session against this list.
 *   - Any change to COOKIE_INVENTORY changes its fingerprint; tests/unit/cookie-policy.test.ts
 *     then fails until COOKIE_POLICY_VERSION is bumped. A new version re-shows the notice and
 *     invalidates stored consent, because a new category, purpose or vendor may need new consent.
 *   - The notice runs in "info" mode while every entry is strictly necessary, and switches to
 *     "consent" mode as soon as a non-necessary entry is added.
 *
 * Pure data: imported by client components, so no Node-only APIs here.
 */

export const COOKIE_POLICY_VERSION = '2026-09-28-v1'
export const COOKIE_POLICY_UPDATED_AT = '28.09.2026'

/** sha256 of the base inventory — see tests/unit/cookie-policy.test.ts. */
export const COOKIE_POLICY_FINGERPRINT = '45828135feca3bb7a0afb13f33c9a6d8f665bbabbd8283eb0d4a9dc98589da74'

export const COOKIE_CATEGORIES = ['necessary', 'functional', 'analytics', 'marketing'] as const
export type CookieCategory = (typeof COOKIE_CATEGORIES)[number]
export type OptionalCookieCategory = Exclude<CookieCategory, 'necessary'>
export const OPTIONAL_COOKIE_CATEGORIES: readonly OptionalCookieCategory[] = ['functional', 'analytics', 'marketing']

export const COOKIE_CATEGORY_LABELS: Record<CookieCategory, { title: string; tableLabel: string; description: string }> = {
  necessary: {
    title: 'Zorunlu Çerezler',
    tableLabel: 'Zorunlu',
    description: 'Sitenin güvenli çalışması, oturum yönetimi ve talep ettiğiniz temel işlevler için gereklidir.',
  },
  functional: {
    title: 'İşlevsel Çerezler',
    tableLabel: 'İşlevsel',
    description: 'Tercihlerinizi hatırlamak gibi ek kolaylıklar sağlar.',
  },
  analytics: {
    title: 'Analitik ve Performans Çerezleri',
    tableLabel: 'Analitik ve Performans',
    description: 'Sitenin nasıl kullanıldığını ölçmemize ve performansını iyileştirmemize yardımcı olur.',
  },
  marketing: {
    title: 'Reklam ve Pazarlama Çerezleri',
    tableLabel: 'Reklam ve Pazarlama',
    description: 'İlgi alanlarınıza uygun reklam ve kampanyalar göstermek için kullanılır.',
  },
}

export const COOKIE_NOTICE_STORAGE_KEY = 'hanuja-cookie-notice'
export const COOKIE_CONSENT_STORAGE_KEY = 'hanuja-cookie-consent'

export type CookieStorageType = 'cookie' | 'localStorage'

export interface CookieInventoryEntry {
  /** Name shown in the policy table. */
  key: string
  /** Anchored regex source matching every real name the browser stores for this entry. */
  namePattern: string
  storage: CookieStorageType
  provider: string
  domain: string
  purpose: string
  category: CookieCategory
  party: 'first' | 'third'
  duration: string
  legalBasis: string
  /** When the entry is created — documentation for the audit, not rendered. */
  trigger: string
}

const SITE_DOMAIN = 'www.hanuja.com.tr (yalnız bu alan adı)'
const HANUJA = 'Hanuja'

const BASE_COOKIE_INVENTORY: readonly CookieInventoryEntry[] = [
  {
    key: 'hanuja-csrf',
    namePattern: '^hanuja-csrf$',
    storage: 'cookie',
    provider: HANUJA,
    domain: SITE_DOMAIN,
    purpose: 'Formlar ve işlemler üzerinden sahte istek gönderilmesini (CSRF) engelleyen güvenlik anahtarı.',
    category: 'necessary',
    party: 'first',
    duration: '24 saat',
    legalBasis: 'KVKK m.5/2-f (bilgi ve işlem güvenliğine ilişkin meşru menfaat)',
    trigger: 'İlk sayfa isteği (apps/web/src/middleware.ts)',
  },
  {
    key: 'hanuja-csrf-mirror',
    namePattern: '^hanuja-csrf-mirror$',
    storage: 'cookie',
    provider: HANUJA,
    domain: SITE_DOMAIN,
    purpose: 'CSRF güvenlik anahtarının tarayıcı tarafından isteklere eklenebilen kopyası.',
    category: 'necessary',
    party: 'first',
    duration: '24 saat',
    legalBasis: 'KVKK m.5/2-f (bilgi ve işlem güvenliğine ilişkin meşru menfaat)',
    trigger: 'İlk sayfa isteği (apps/web/src/middleware.ts)',
  },
  {
    key: 'better-auth.session_token',
    namePattern: '^(__Secure-)?better-auth\\.session_token$',
    storage: 'cookie',
    provider: HANUJA,
    domain: SITE_DOMAIN,
    purpose: 'Üye girişi yaptığınızda oturumunuzu açık tutar ve hesabınıza ait sayfalara erişimi doğrular.',
    category: 'necessary',
    party: 'first',
    duration: '30 gün',
    legalBasis: 'KVKK m.5/2-c (üyelik sözleşmesinin kurulması ve ifası)',
    trigger: 'Giriş, kayıt veya Google ile giriş dönüşü',
  },
  {
    key: 'better-auth.session_data',
    namePattern: '^(__Secure-)?better-auth\\.session_data(\\.\\d+)?$',
    storage: 'cookie',
    provider: HANUJA,
    domain: SITE_DOMAIN,
    purpose: 'Oturum bilgisinin kısa süreli önbelleği; her sayfada oturumun yeniden sorgulanmasını azaltır.',
    category: 'necessary',
    party: 'first',
    duration: '5 dakika',
    legalBasis: 'KVKK m.5/2-c (üyelik sözleşmesinin kurulması ve ifası)',
    trigger: 'Oturum açıkken oturum doğrulaması',
  },
  {
    key: 'better-auth.state',
    namePattern: '^(__Secure-)?better-auth\\.state$',
    storage: 'cookie',
    provider: HANUJA,
    domain: SITE_DOMAIN,
    purpose: 'Google ile giriş sırasında dönüş isteğinin sizin başlattığınız işleme ait olduğunu doğrular.',
    category: 'necessary',
    party: 'first',
    duration: '5 dakika',
    legalBasis: 'KVKK m.5/2-c (üyelik sözleşmesinin kurulması ve ifası)',
    trigger: 'Yalnız "Google ile giriş yap" tıklandığında',
  },
  {
    key: COOKIE_NOTICE_STORAGE_KEY,
    namePattern: `^${COOKIE_NOTICE_STORAGE_KEY}$`,
    storage: 'localStorage',
    provider: HANUJA,
    domain: SITE_DOMAIN,
    purpose: 'Çerez bilgilendirmesini gördüğünüzü hatırlar; bilgilendirme yalnız metin güncellenince yeniden gösterilir.',
    category: 'necessary',
    party: 'first',
    duration: 'Tarayıcı verilerini silene kadar',
    legalBasis: 'Kişisel veri içermez (yalnız metin sürümü saklanır)',
    trigger: 'Çerez bilgilendirmesinde "Anladım" tıklandığında',
  },
  {
    key: COOKIE_CONSENT_STORAGE_KEY,
    namePattern: `^${COOKIE_CONSENT_STORAGE_KEY}$`,
    storage: 'localStorage',
    provider: HANUJA,
    domain: SITE_DOMAIN,
    purpose: 'Zorunlu olmayan çerezlere ilişkin tercihinizi ve bu tercihin kayıt numarasını saklar.',
    category: 'necessary',
    party: 'first',
    duration: 'Tarayıcı verilerini silene kadar',
    legalBasis: 'KVKK m.5/2-ç (açık rızanın ispatına ilişkin hukuki yükümlülük)',
    trigger: 'Çerez tercihi kaydedildiğinde',
  },
]

/**
 * E2E-only fixture: exercises consent mode end to end while production has no
 * optional cookies. `tools/scripts/check-env.ts` rejects the flag in production.
 * Literal `process.env.NEXT_PUBLIC_*` access so Next.js inlines it at build time.
 */
export function isCookieConsentE2EFixtureEnabled(): boolean {
  return process.env.NEXT_PUBLIC_COOKIE_CONSENT_E2E_FIXTURE === '1'
}

const E2E_FIXTURE_INVENTORY: readonly CookieInventoryEntry[] = [
  {
    key: 'hanuja_e2e_analytics',
    namePattern: '^hanuja_e2e_analytics$',
    storage: 'cookie',
    provider: 'E2E test fikstürü',
    domain: SITE_DOMAIN,
    purpose: 'Yalnız otomatik testlerde analitik rıza akışını doğrular.',
    category: 'analytics',
    party: 'first',
    duration: 'Oturum',
    legalBasis: 'KVKK m.5/1 (açık rıza)',
    trigger: 'Analitik rızası verildiğinde test script’i',
  },
  {
    key: 'hanuja_e2e_marketing',
    namePattern: '^hanuja_e2e_marketing$',
    storage: 'cookie',
    provider: 'E2E test fikstürü',
    domain: SITE_DOMAIN,
    purpose: 'Yalnız otomatik testlerde pazarlama rıza akışını doğrular.',
    category: 'marketing',
    party: 'first',
    duration: 'Oturum',
    legalBasis: 'KVKK m.5/1 (açık rıza)',
    trigger: 'Pazarlama rızası verildiğinde test script’i',
  },
]

export function getBaseCookieInventory(): readonly CookieInventoryEntry[] {
  return BASE_COOKIE_INVENTORY
}

export function getCookieInventory(): readonly CookieInventoryEntry[] {
  return isCookieConsentE2EFixtureEnabled() ? [...BASE_COOKIE_INVENTORY, ...E2E_FIXTURE_INVENTORY] : BASE_COOKIE_INVENTORY
}

export type CookieNoticeMode = 'info' | 'consent'

/** Optional categories that currently have at least one real entry. */
export function getActiveOptionalCategories(
  inventory: readonly CookieInventoryEntry[] = getCookieInventory(),
): OptionalCookieCategory[] {
  return OPTIONAL_COOKIE_CATEGORIES.filter((category) => inventory.some((entry) => entry.category === category))
}

export function getCookieNoticeMode(inventory: readonly CookieInventoryEntry[] = getCookieInventory()): CookieNoticeMode {
  return getActiveOptionalCategories(inventory).length > 0 ? 'consent' : 'info'
}

/**
 * External hosts the storefront browser is expected to contact. Used by the cookie
 * audit and the E2E "no unexpected request" check — not a vendor list for the page.
 */
export const EXPECTED_EXTERNAL_HOSTS: readonly { host: string; provider: string; where: string }[] = [
  { host: 'challenges.cloudflare.com', provider: 'Cloudflare Turnstile', where: '/giris, /kayit, /odeme' },
  // Seen in the 2026-09-28 production audit: Turnstile's widget also calls a challenge subdomain.
  { host: '*.challenges.cloudflare.com', provider: 'Cloudflare Turnstile', where: '/giris, /kayit, /odeme' },
  { host: 'media.hanuja.tr', provider: 'Cloudflare (medya CDN)', where: 'Ürün, ana sayfa ve mağaza görselleri' },
  { host: 'accounts.google.com', provider: 'Google', where: 'Yalnız "Google ile giriş yap" tıklandığında' },
  { host: '*.r2.cloudflarestorage.com', provider: 'Cloudflare R2', where: 'Sipariş destek ve iade fotoğrafı yükleme' },
]

export function isExpectedExternalHost(host: string): boolean {
  return EXPECTED_EXTERNAL_HOSTS.some(({ host: expected }) =>
    expected.startsWith('*.') ? host.endsWith(expected.slice(1)) : host === expected,
  )
}
