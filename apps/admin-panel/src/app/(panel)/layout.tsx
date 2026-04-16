import type { Metadata } from 'next'
import { SidebarNav, type NavSection } from '@hanuja/ui'
import {
  LayoutDashboard,
  Store,
  ShoppingBag,
  CreditCard,
  Wallet,
  AlertOctagon,
  RotateCcw,
  Package,
  ScrollText,
  Settings,
  Shield,
  MessageCircleWarning,
} from 'lucide-react'

export const metadata: Metadata = {
  title: {
    template: '%s | Hanuja Admin',
    default: 'Admin Paneli',
  },
}

const NAV_SECTIONS: NavSection[] = [
  {
    items: [
      { label: 'Kontrol Paneli', href: '/dashboard', icon: <LayoutDashboard className="h-4 w-4" /> },
    ],
  },
  {
    title: 'Pazar Yeri',
    items: [
      { label: 'Satıcılar', href: '/saticilar', icon: <Store className="h-4 w-4" /> },
      { label: 'Siparişler', href: '/siparisler', icon: <ShoppingBag className="h-4 w-4" /> },
      { label: 'Ürün Moderasyon', href: '/urunler', icon: <Package className="h-4 w-4" /> },
    ],
  },
  {
    title: 'Finans',
    items: [
      { label: 'Ödemeler', href: '/odemeler', icon: <CreditCard className="h-4 w-4" /> },
      { label: 'Hakedişler', href: '/hakedisler', icon: <Wallet className="h-4 w-4" /> },
      { label: 'Cezalar', href: '/cezalar', icon: <AlertOctagon className="h-4 w-4" /> },
      { label: 'Finans Özeti', href: '/finans', icon: <ScrollText className="h-4 w-4" /> },
    ],
  },
  {
    title: 'Operasyon',
    items: [
      { label: 'İadeler', href: '/iadeler', icon: <RotateCcw className="h-4 w-4" /> },
      { label: 'Uyuşmazlıklar', href: '/uyusmazliklar', icon: <MessageCircleWarning className="h-4 w-4" /> },
      { label: 'Denetim Günlüğü', href: '/denetim', icon: <Shield className="h-4 w-4" /> },
    ],
  },
  {
    title: 'Sistem',
    items: [
      { label: 'Ayarlar', href: '/ayarlar', icon: <Settings className="h-4 w-4" /> },
    ],
  },
]

export default function AdminPanelLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen" style={{ backgroundColor: 'var(--color-background)' }}>
      {/* Sidebar */}
      <aside
        className="hidden w-60 shrink-0 border-r md:flex md:flex-col"
        style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
      >
        <div
          className="flex h-14 items-center gap-2 border-b px-4"
          style={{ borderColor: 'var(--color-border)' }}
        >
          <Shield className="h-5 w-5" style={{ color: 'var(--color-accent)' }} />
          <span className="font-semibold" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-primary)' }}>
            Hanuja
          </span>
          <span
            className="ml-auto rounded px-1.5 py-0.5 text-xs font-medium"
            style={{ backgroundColor: 'var(--color-accent)', color: 'white' }}
          >
            Admin
          </span>
        </div>
        <div className="flex-1 overflow-y-auto py-4">
          <SidebarNav sections={NAV_SECTIONS} />
        </div>
      </aside>

      {/* Main */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <header
          className="flex h-14 items-center justify-between border-b px-4 sm:px-6"
          style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
        >
          <div className="md:hidden">
            <span className="font-semibold" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-primary)' }}>
              Hanuja Admin
            </span>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <span className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>Admin</span>
            <div className="h-8 w-8 rounded-full flex items-center justify-center text-sm font-semibold text-white" style={{ backgroundColor: 'var(--color-accent)' }}>
              A
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
