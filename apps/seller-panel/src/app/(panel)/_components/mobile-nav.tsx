'use client'

import { useState } from 'react'
import { usePathname } from 'next/navigation'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  SidebarNav,
  type NavSection,
} from '@hanuja/ui'
import {
  BarChart3,
  Download,
  Images,
  LayoutDashboard,
  LifeBuoy,
  Menu,
  Package,
  Percent,
  ReceiptText,
  RefreshCcw,
  RotateCcw,
  Settings,
  ShoppingBag,
  Truck,
  Upload,
  Wallet,
} from 'lucide-react'

const MOBILE_NAV_SECTIONS: NavSection[] = [
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

export function MobileNav() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        aria-label="Menüyü aç"
        onClick={() => setOpen(true)}
        className="inline-flex h-10 w-10 items-center justify-center rounded-md border md:hidden"
        style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)' }}
      >
        <Menu className="h-5 w-5" />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="left-0 top-0 h-dvh max-w-[19rem] translate-x-0 translate-y-0 rounded-none border-y-0 border-l-0 p-0 data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left"
          aria-describedby={undefined}
        >
          <DialogHeader className="border-b px-4 py-4 text-left" style={{ borderColor: 'var(--color-border)' }}>
            <DialogTitle>Hanuja Satıcı</DialogTitle>
            <DialogDescription id="mobile-seller-nav-description">
              Satıcı paneli bölümleri
            </DialogDescription>
          </DialogHeader>
          <div className="overflow-y-auto px-3 py-4">
            <div onClick={(event) => {
              if ((event.target as HTMLElement).closest('a')) {
                setOpen(false)
              }
            }}>
              <SidebarNav sections={MOBILE_NAV_SECTIONS} pathname={pathname} />
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
