import type { Metadata } from 'next'
import { SidebarNav, type NavSection } from '@hanuja/ui'
import {
  LayoutDashboard,
  Package,
  ShoppingBag,
  Truck,
  Wallet,
  RotateCcw,
  Settings,
  Store,
} from 'lucide-react'
import { getSellerFromSession } from '@/lib/seller-session'

export const metadata: Metadata = {
  title: {
    template: '%s | Hanuja Satıcı Paneli',
    default: 'Satıcı Paneli',
  },
}

const NAV_SECTIONS: NavSection[] = [
  {
    items: [
      { label: 'Kontrol Paneli', href: '/dashboard', icon: <LayoutDashboard className="h-4 w-4" /> },
    ],
  },
  {
    title: 'Katalog',
    items: [
      { label: 'Ürünlerim', href: '/urunler', icon: <Package className="h-4 w-4" /> },
    ],
  },
  {
    title: 'Siparişler',
    items: [
      { label: 'Siparişler', href: '/siparisler', icon: <ShoppingBag className="h-4 w-4" /> },
      { label: 'Kargolar', href: '/kargolar', icon: <Truck className="h-4 w-4" /> },
      { label: 'İadeler', href: '/iadeler', icon: <RotateCcw className="h-4 w-4" /> },
    ],
  },
  {
    title: 'Finans',
    items: [
      { label: 'Ödemeler & Hakediş', href: '/odemeler', icon: <Wallet className="h-4 w-4" /> },
    ],
  },
  {
    title: 'Mağaza',
    items: [
      { label: 'Ayarlar', href: '/ayarlar', icon: <Settings className="h-4 w-4" /> },
    ],
  },
]

export default async function SellerPanelLayout({ children }: { children: React.ReactNode }) {
  const { seller } = await getSellerFromSession()
  const displayName = seller.displayName
  const initial = displayName.charAt(0).toUpperCase()

  return (
    <div
      className="flex min-h-screen"
      style={{ backgroundColor: 'var(--color-background)' }}
    >
      {/* Sidebar */}
      <aside
        className="hidden w-56 shrink-0 border-r md:flex md:flex-col"
        style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
      >
        <div
          className="flex h-14 items-center gap-2 border-b px-4"
          style={{ borderColor: 'var(--color-border)' }}
        >
          <Store className="h-5 w-5" style={{ color: 'var(--color-accent)' }} />
          <span
            className="font-semibold"
            style={{ fontFamily: 'var(--font-display)', color: 'var(--color-primary)' }}
          >
            Hanuja
          </span>
          <span
            className="ml-auto rounded px-1.5 py-0.5 text-xs font-medium"
            style={{ backgroundColor: 'var(--color-muted)', color: 'var(--color-muted-fg)' }}
          >
            Satıcı
          </span>
        </div>
        <div className="flex-1 overflow-y-auto py-4">
          <SidebarNav sections={NAV_SECTIONS} />
        </div>
      </aside>

      {/* Main */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top bar */}
        <header
          className="flex h-14 items-center justify-between border-b px-4 sm:px-6"
          style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
        >
          <div className="md:hidden">
            <span
              className="font-semibold"
              style={{ fontFamily: 'var(--font-display)', color: 'var(--color-primary)' }}
            >
              Hanuja Satıcı
            </span>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <span className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>{displayName}</span>
            <div
              className="h-8 w-8 rounded-full flex items-center justify-center text-sm font-semibold text-white"
              style={{ backgroundColor: 'var(--color-accent)' }}
            >
              {initial}
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 sm:p-6">
          {children}
        </main>
      </div>
    </div>
  )
}
