import type { Metadata } from 'next'
import { NotificationBell, SidebarNav, type NavSection } from '@hanuja/ui'
import {
  BarChart3,
  Images,
  LayoutDashboard,
  LifeBuoy,
  Megaphone,
  MessageCircleQuestion,
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
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { createProductQuestionService } from '@hanuja/api/services/product-question.service'
import { createAnnouncementService } from '@hanuja/api/services/announcement.service'
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
      { label: 'Müşteri Soruları', href: '/musteri-sorulari', icon: <MessageCircleQuestion className="h-4 w-4" /> },
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
      { label: 'Duyurular', href: '/duyurular', icon: <Megaphone className="h-4 w-4" /> },
      { label: 'Destek', href: '/destek', icon: <LifeBuoy className="h-4 w-4" /> },
    ],
  },
]

// A suspended seller keeps order, return, question and finance work plus support;
// filtered by href so adding a menu item never shifts what stays visible.
const SUSPENDED_SECTION_TITLES = new Set(['Siparişler', 'Finans'])
// Suspended sellers keep support and announcements from the Mağaza section.
const SUSPENDED_STORE_HREFS = new Set(['/destek', '/duyurular'])

function suspendedNavSections(sections: NavSection[]): NavSection[] {
  return sections
    .map((section) => {
      if (section.title && SUSPENDED_SECTION_TITLES.has(section.title)) return section
      if (section.title === 'Mağaza') {
        return { ...section, items: section.items.filter((item) => SUSPENDED_STORE_HREFS.has(item.href)) }
      }
      return null
    })
    .filter((section): section is NavSection => section !== null)
}

/** Unread counters by nav href (customer questions, announcements). */
function withUnreadBadges(sections: NavSection[], unreadByHref: Record<string, number>): NavSection[] {
  return sections.map((section) => ({
    ...section,
    items: section.items.map((item) => {
      const unread = unreadByHref[item.href] ?? 0
      return unread > 0 ? { ...item, badge: unread > 99 ? '99+' : unread } : item
    }),
  }))
}

export default async function SellerPanelLayout({ children }: { children: React.ReactNode }) {
  const { seller } = await getSellerFromSession({ allowSuspended: true })
  const displayName = seller.displayName
  const initial = displayName.charAt(0).toUpperCase()
  const prisma = createPrismaForRoute()
  const [unreadQuestions, unreadAnnouncements] = await Promise.all([
    createProductQuestionService({ prisma }).countUnreadForSeller(seller.id).catch(() => 0),
    createAnnouncementService({ prisma }).countUnreadForSeller(seller.id).catch(() => 0),
  ])
  const sections = withUnreadBadges(NAV_SECTIONS, {
    '/musteri-sorulari': unreadQuestions,
    '/duyurular': unreadAnnouncements,
  })
  const navSections = seller.status === 'suspended' ? suspendedNavSections(sections) : sections

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
