import React from 'react'
import Link from 'next/link'
import { ShoppingCart, User, Search, Menu } from 'lucide-react'

const NAV_CATEGORIES = [
  { label: 'Mobilya', href: '/kategori/mobilya' },
  { label: 'Dekor', href: '/kategori/dekor' },
  { label: 'Aydınlatma', href: '/kategori/aydinlatma' },
  { label: 'Ofis', href: '/kategori/ofis' },
  { label: 'Banyo', href: '/kategori/banyo' },
  { label: 'Mutfak', href: '/kategori/mutfak' },
  { label: 'Blog', href: '/blog' },
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
      {/* Top bar */}
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between gap-4">
          {/* Logo */}
          <Link
            href="/"
            className="shrink-0 text-2xl font-semibold tracking-tight"
            style={{
              fontFamily: 'var(--font-display)',
              color: 'var(--color-primary)',
            }}
          >
            Hanuja
          </Link>

          {/* Search — hidden on mobile */}
          <div className="hidden flex-1 max-w-md md:flex">
            <div
              className="flex w-full items-center gap-2 rounded-full border px-4 py-2 text-sm"
              style={{
                borderColor: 'var(--color-border)',
                backgroundColor: 'var(--color-muted)',
                color: 'var(--color-muted-fg)',
              }}
            >
              <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>Ürün, mağaza veya kategori ara…</span>
            </div>
          </div>

          {/* Right actions */}
          <div className="flex items-center gap-1">
            {/* Mobile search */}
            <button
              className="md:hidden flex h-9 w-9 items-center justify-center rounded-full transition-colors hover:bg-[var(--color-muted)]"
              aria-label="Ara"
            >
              <Search className="h-5 w-5" style={{ color: 'var(--color-primary)' }} />
            </button>

            {/* Account */}
            <Link
              href="/hesabim"
              className="flex h-9 w-9 items-center justify-center rounded-full transition-colors hover:bg-[var(--color-muted)]"
              aria-label="Hesabım"
            >
              <User className="h-5 w-5" style={{ color: 'var(--color-primary)' }} />
            </Link>

            {/* Cart */}
            <Link
              href="/sepet"
              className="relative flex h-9 w-9 items-center justify-center rounded-full transition-colors hover:bg-[var(--color-muted)]"
              aria-label="Sepet"
            >
              <ShoppingCart className="h-5 w-5" style={{ color: 'var(--color-primary)' }} />
            </Link>
          </div>
        </div>
      </div>

      {/* Category nav */}
      <nav
        aria-label="Kategoriler"
        className="border-t"
        style={{ borderColor: 'var(--color-border)' }}
      >
        <div className="mx-auto max-w-7xl overflow-x-auto px-4 sm:px-6 lg:px-8">
          <ul className="flex items-center gap-0 whitespace-nowrap">
            {NAV_CATEGORIES.map((cat) => (
              <li key={cat.href}>
                <Link
                  href={cat.href}
                  className="inline-block px-4 py-3 text-sm font-medium transition-colors hover:text-[var(--color-accent)]"
                  style={{ color: 'var(--color-primary)' }}
                >
                  {cat.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </nav>
    </header>
  )
}

function SiteFooter() {
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
          {/* Brand */}
          <div className="col-span-2 md:col-span-1">
            <p
              className="text-xl font-semibold"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              Hanuja
            </p>
            <p
              className="mt-2 text-sm leading-relaxed"
              style={{ color: 'rgba(255,255,255,0.6)' }}
            >
              Ev, ofis ve yaşam ürünlerinde seçkin mağazalar.
            </p>
          </div>

          {/* Alışveriş */}
          <div>
            <p className="text-sm font-semibold uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.5)' }}>
              Alışveriş
            </p>
            <ul className="mt-4 space-y-2 text-sm" style={{ color: 'rgba(255,255,255,0.75)' }}>
              <li><Link href="/kategori/mobilya" className="hover:text-white transition-colors">Mobilya</Link></li>
              <li><Link href="/kategori/dekor" className="hover:text-white transition-colors">Dekor</Link></li>
              <li><Link href="/kategori/aydinlatma" className="hover:text-white transition-colors">Aydınlatma</Link></li>
              <li><Link href="/blog" className="hover:text-white transition-colors">Blog & İlham</Link></li>
            </ul>
          </div>

          {/* Yardım */}
          <div>
            <p className="text-sm font-semibold uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.5)' }}>
              Yardım
            </p>
            <ul className="mt-4 space-y-2 text-sm" style={{ color: 'rgba(255,255,255,0.75)' }}>
              <li><Link href="/siparis" className="hover:text-white transition-colors">Siparişlerim</Link></li>
              <li><Link href="/hesabim" className="hover:text-white transition-colors">Hesabım</Link></li>
              <li><a href="#" className="hover:text-white transition-colors">İade & Değişim</a></li>
              <li><a href="#" className="hover:text-white transition-colors">İletişim</a></li>
            </ul>
          </div>

          {/* Satıcı */}
          <div>
            <p className="text-sm font-semibold uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.5)' }}>
              Satıcılar
            </p>
            <ul className="mt-4 space-y-2 text-sm" style={{ color: 'rgba(255,255,255,0.75)' }}>
              <li><a href="#" className="hover:text-white transition-colors">Mağaza Aç</a></li>
              <li><a href="#" className="hover:text-white transition-colors">Satıcı Paneli</a></li>
              <li><a href="#" className="hover:text-white transition-colors">Satıcı Kuralları</a></li>
            </ul>
          </div>
        </div>

        <div
          className="mt-10 border-t pt-6 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between text-xs"
          style={{ borderColor: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.4)' }}
        >
          <p>© {new Date().getFullYear()} Hanuja. Tüm hakları saklıdır.</p>
          <div className="flex gap-4">
            <a href="#" className="hover:text-white transition-colors">Gizlilik Politikası</a>
            <a href="#" className="hover:text-white transition-colors">Kullanım Koşulları</a>
            <a href="#" className="hover:text-white transition-colors">KVKK</a>
          </div>
        </div>
      </div>
    </footer>
  )
}

export default function StorefrontLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <>
      <SiteHeader />
      <main>{children}</main>
      <SiteFooter />
    </>
  )
}
