import React, { Suspense } from 'react'
import Link from 'next/link'
import { Heart, User, Search } from 'lucide-react'
import { HanujaLogo } from '@hanuja/ui'
import { getSellerPanelUrl, PLATFORM_LEGAL_INFO } from '@hanuja/api/lib/platform-info'
import { isCardPaymentsEnabled } from '@hanuja/api/lib/payment-capabilities'
import CartIcon from '@/components/cart-icon'
import { StorefrontNav } from '@/components/storefront/storefront-nav'
import { VIRTUAL_COLLECTION_MAP } from '@/config/storefront-nav'
import { getCustomerVisibleCategories } from '@/lib/customer-visible-categories'

const SELLER_PANEL_URL = getSellerPanelUrl()

// Alt ağacında yayınlanmış ürün olan linkler gösterilir (bkz. visibilitySlugs
// slug-bağımlılığı uyarısı: config/storefront-nav.ts).
const FOOTER_CATEGORY_LINKS: Array<{
  label: string
  href: string
  visibilitySlugs: readonly string[]
}> = [
  { label: 'Mobilya', href: '/kategori/mobilya', visibilitySlugs: VIRTUAL_COLLECTION_MAP.mobilya },
  { label: 'Aydınlatma', href: '/kategori/aydinlatma', visibilitySlugs: VIRTUAL_COLLECTION_MAP.aydinlatma },
  { label: 'Dekorasyon', href: '/kategori/ev-dekorasyon', visibilitySlugs: ['ev-dekorasyon'] },
]

function SiteHeader() {
  return (
    <header
      className="sticky top-0 z-40 border-b"
      style={{
        backgroundColor: 'var(--color-surface)',
        borderColor: 'var(--color-border)',
      }}
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between gap-1 min-[400px]:gap-4">
          <Link href="/" className="min-w-0 shrink-0" aria-label="Hanuja — Ana Sayfa">
            <span className="inline-flex min-[400px]:hidden">
              <HanujaLogo scale={0.58} textScale={0.72} showTagline={false} variant="light" />
            </span>
            <span className="hidden min-[400px]:inline-flex">
              <HanujaLogo scale={0.85} textScale={1.4} variant="light" />
            </span>
          </Link>

          <form action="/arama" className="hidden flex-1 max-w-md md:flex">
            <label
              className="flex w-full items-center gap-2 rounded-full border px-4 py-2 text-sm"
              style={{
                borderColor: 'var(--color-border)',
                backgroundColor: 'var(--color-muted)',
                color: 'var(--color-muted-fg)',
              }}
            >
              <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
              <input
                name="q"
                type="search"
                placeholder="Ürün, mağaza veya kategori ara..."
                className="w-full bg-transparent outline-none placeholder:text-[var(--color-muted-fg)]"
                aria-label="Ürün, mağaza veya kategori ara"
              />
            </label>
          </form>

          <div className="flex items-center gap-1">
            <Link
              href="/arama"
              className="md:hidden flex h-9 w-9 items-center justify-center rounded-full transition-colors hover:bg-[var(--color-muted)]"
              aria-label="Ara"
            >
              <Search className="h-5 w-5" style={{ color: 'var(--color-primary)' }} />
            </Link>

            <Link
              href="/hesabim"
              className="flex h-9 w-9 items-center justify-center rounded-full transition-colors hover:bg-[var(--color-muted)]"
              aria-label="Hesabım"
            >
              <User className="h-5 w-5" style={{ color: 'var(--color-primary)' }} />
            </Link>

            <Link
              href="/hesabim/favoriler"
              className="flex h-9 w-9 items-center justify-center rounded-full transition-colors hover:bg-[var(--color-muted)]"
              aria-label="Favorilerim"
            >
              <Heart className="h-5 w-5" style={{ color: 'var(--color-primary)' }} />
            </Link>

            <CartIcon />
          </div>
        </div>
      </div>

      {/* Mega-menu nav — async server component with Suspense fallback */}
      <Suspense fallback={<NavFallback />}>
        <StorefrontNav />
      </Suspense>
    </header>
  )
}

/** Minimal nav shown while StorefrontNav awaits DB. */
function NavFallback() {
  return (
    <div
      className="border-t"
      style={{ borderColor: 'var(--color-border)', height: '45px' }}
    />
  )
}

function PaymentBadge({ label }: { label: string }) {
  return (
    <span
      className="inline-flex items-center justify-center rounded px-2 py-1 text-xs font-bold tracking-wide"
      style={{
        backgroundColor: 'rgba(255,255,255,0.15)',
        color: 'rgba(255,255,255,0.85)',
        minWidth: '2.5rem',
      }}
    >
      {label}
    </span>
  )
}

async function SiteFooter() {
  const year = new Date().getFullYear()
  const cardPaymentsEnabled = isCardPaymentsEnabled()

  let visibleSlugs: Set<string> | null = null
  try {
    const visibleCategories = await getCustomerVisibleCategories()
    visibleSlugs = new Set(visibleCategories.map((category) => category.slug))
  } catch {
    // DB unreachable — keep all links rather than blanking the footer block.
  }
  const categoryLinks = visibleSlugs
    ? FOOTER_CATEGORY_LINKS.filter((link) =>
        link.visibilitySlugs.some((slug) => visibleSlugs.has(slug)),
      )
    : FOOTER_CATEGORY_LINKS

  return (
    <footer
      className="mt-20 border-t"
      style={{
        backgroundColor: 'var(--color-primary)',
        borderColor: 'var(--color-primary)',
        color: 'var(--color-primary-fg)',
      }}
    >
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
          <div className="col-span-2 md:col-span-1">
            <HanujaLogo scale={0.5} variant="dark" />
            <p className="mt-3 text-sm leading-relaxed" style={{ color: 'rgba(255,255,255,0.6)' }}>
              Ev, ofis ve yaşam ürünlerinde seçkin mağazalar.
            </p>
          </div>

          <div>
            <p
              className="text-sm font-semibold uppercase tracking-wider"
              style={{ color: 'rgba(255,255,255,0.5)' }}
            >
              Alışveriş
            </p>
            <ul className="mt-4 space-y-2 text-sm" style={{ color: 'rgba(255,255,255,0.75)' }}>
              {categoryLinks.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="hover:text-white transition-colors">
                    {link.label}
                  </Link>
                </li>
              ))}
              <li>
                <Link href="/blog" className="hover:text-white transition-colors">
                  Blog & İlham
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <p
              className="text-sm font-semibold uppercase tracking-wider"
              style={{ color: 'rgba(255,255,255,0.5)' }}
            >
              Yardım
            </p>
            <ul className="mt-4 space-y-2 text-sm" style={{ color: 'rgba(255,255,255,0.75)' }}>
              <li>
                <Link href="/siparis" className="hover:text-white transition-colors">
                  Siparişlerim
                </Link>
              </li>
              <li>
                <Link href="/hesabim" className="hover:text-white transition-colors">
                  Hesabım
                </Link>
              </li>
              <li>
                <Link href="/iade-iptal" className="hover:text-white transition-colors">
                  İade & Değişim
                </Link>
              </li>
              <li>
                <Link href="/on-bilgilendirme" className="hover:text-white transition-colors">
                  Ön Bilgilendirme
                </Link>
              </li>
              <li>
                <Link href="/hakkimizda" className="hover:text-white transition-colors">
                  Hakkımızda
                </Link>
              </li>
              <li>
                <Link href="/iletisim" className="hover:text-white transition-colors">
                  İletişim
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <p
              className="text-sm font-semibold uppercase tracking-wider"
              style={{ color: 'rgba(255,255,255,0.5)' }}
            >
              Başvuru
            </p>
            <ul className="mt-4 space-y-2 text-sm" style={{ color: 'rgba(255,255,255,0.75)' }}>
              <li>
                <a
                  href={`${SELLER_PANEL_URL}/basvuru`}
                  className="hover:text-white transition-colors"
                >
                  Mağaza Başvurusu
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div
          className="mt-10 border-t pt-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"
          style={{ borderColor: 'rgba(255,255,255,0.1)' }}
        >
          <div className="flex items-center gap-3 flex-wrap">
            {cardPaymentsEnabled ? (
              <>
                <PaymentBadge label="Troy" />
                <PaymentBadge label="Amex" />
              </>
            ) : (
              <PaymentBadge label="Havale / EFT ile ödeme" />
            )}
            {/* The combined brand artwork is a fixed transparent public asset. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/payment/visa-mastercard.png"
              alt="Visa ve Mastercard"
              width="1875"
              height="839"
              className="h-[52px] w-auto shrink-0 object-contain"
            />
            <div
              className="flex items-center gap-1 rounded px-2 py-1 text-xs font-semibold"
              style={{ backgroundColor: 'rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.7)' }}
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                aria-hidden="true"
              >
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              SSL Güvenli
            </div>
          </div>
          <p className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>
            {cardPaymentsEnabled
              ? 'Kart ödemeleri güvenli altyapı üzerinden işlenir.'
              : 'Siparişler güvenli Havale / EFT yöntemiyle alınır.'}
          </p>
        </div>

        <div
          className="mt-4 border-t pt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between text-xs"
          style={{ borderColor: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.4)' }}
        >
          <p>
            © {year} {PLATFORM_LEGAL_INFO.brandDisplay}. Tüm hakları saklıdır.
          </p>
          <div className="flex flex-wrap gap-4">
            <Link href="/gizlilik-politikasi" className="hover:text-white transition-colors">
              Gizlilik Politikası
            </Link>
            <Link href="/kullanim-kosullari" className="hover:text-white transition-colors">
              Kullanım Koşulları
            </Link>
            <Link href="/kvkk" className="hover:text-white transition-colors">
              KVKK
            </Link>
            <Link href="/mesafeli-satis" className="hover:text-white transition-colors">
              Mesafeli Satış Sözleşmesi
            </Link>
            <Link href="/on-bilgilendirme" className="hover:text-white transition-colors">
              Ön Bilgilendirme Formu
            </Link>
            <Link href="/iade-iptal" className="hover:text-white transition-colors">
              İade & İptal
            </Link>
            <Link href="/islem-rehberi" className="hover:text-white transition-colors">
              İşlem Rehberi
            </Link>
          </div>
        </div>
      </div>
    </footer>
  )
}

export default function StorefrontLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader />
      <main>{children}</main>
      <SiteFooter />
    </>
  )
}
