import type { Metadata } from 'next'
import { NotificationBell, SidebarNav, type NavSection } from '@hanuja/ui'
import {
  BarChart3,
  Download,
  Images,
  LayoutDashboard,
  LifeBuoy,
  Package,
  Percent,
  ReceiptText,
  RefreshCcw,
  RotateCcw,
  Settings,
  ShoppingBag,
  Store,
  Truck,
  Upload,
  Wallet,
} from 'lucide-react'
import { getSellerFromSession } from '@/lib/seller-session'
import { UserMenu } from './_components/user-menu'
import { MobileNav } from './_components/mobile-nav'

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
      { label: 'Rapor', href: '/rapor', icon: <BarChart3 className="h-4 w-4" /> },
    ],
  },
  {
    title: 'Katalog',
    items: [
      { label: 'Ürünlerim', href: '/urunler', icon: <Package className="h-4 w-4" /> },
      { label: 'İçe Aktar', href: '/urunler/ice-aktar', icon: <Download className="h-4 w-4" /> },
      { label: 'Toplu Yükle', href: '/urunler/toplu-yukle', icon: <Upload className="h-4 w-4" /> },
      { label: 'Toplu Güncelle', href: '/urunler/toplu-guncelle', icon: <RefreshCcw className="h-4 w-4" /> },
      { label: 'Medya Havuzu', href: '/medya', icon: <Images className="h-4 w-4" /> },
      { label: 'İndirimler', href: '/indirimler', icon: <Percent className="h-4 w-4" /> },
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
      { label: 'Muhasebe Ekstresi', href: '/odemeler/muhasebe-ekstresi', icon: <ReceiptText className="h-4 w-4" /> },
    ],
  },
  {
    title: 'Mağaza',
    items: [
      { label: 'Ayarlar', href: '/ayarlar', icon: <Settings className="h-4 w-4" /> },
      { label: 'Destek', href: '/destek', icon: <LifeBuoy className="h-4 w-4" /> },
    ],
  },
]

export default async function SellerPanelLayout({ children }: { children: React.ReactNode }) {
  const { seller } = await getSellerFromSession({ allowSuspended: true })
  const displayName = seller.displayName
  const initial = displayName.charAt(0).toUpperCase()
  const navSections = seller.status === 'suspended'
    ? [
        NAV_SECTIONS[2]!,
        NAV_SECTIONS[3]!,
        {
          ...NAV_SECTIONS[4]!,
          items: NAV_SECTIONS[4]!.items.filter((item) => item.href === '/destek'),
        },
      ]
    : NAV_SECTIONS

  return (
    <div className="flex min-h-screen" style={{ backgroundColor: 'var(--color-background)' }}>
      <aside
        className="hidden w-56 shrink-0 border-r md:flex md:flex-col"
        style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
      >
        <div className="flex h-14 items-center gap-2 border-b px-4" style={{ borderColor: 'var(--color-border)' }}>
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
          <SidebarNav sections={navSections} />
        </div>
      </aside>

      <div className="flex flex-1 flex-col overflow-hidden">
        <header
          className="flex h-14 items-center justify-between border-b px-4 sm:px-6"
          style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
        >
          <div className="flex items-center gap-3 md:hidden">
            <MobileNav sections={navSections} />
            <span
              className="font-semibold"
              style={{ fontFamily: 'var(--font-display)', color: 'var(--color-primary)' }}
            >
              Hanuja Satıcı
            </span>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <NotificationBell apiPath="/api/notifications" />
            <UserMenu displayName={displayName} initial={initial} />
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 sm:p-6">
          {seller.status === 'suspended' ? (
            <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              Mağazanız askıya alındı. Yeni satış ve katalog işlemleri kapalıdır; mevcut sipariş, iade ve finans kayıtlarını yönetebilirsiniz.
            </div>
          ) : null}
          {children}
        </main>
      </div>
    </div>
  )
}
