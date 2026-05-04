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
import { Menu } from 'lucide-react'

export function MobileNav({ sections }: { sections: NavSection[] }) {
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
            <DialogTitle>Hanuja Admin</DialogTitle>
            <DialogDescription id="mobile-admin-nav-description">
              Admin paneli bölümleri
            </DialogDescription>
          </DialogHeader>
          <div className="overflow-y-auto px-3 py-4">
            <div onClick={(event) => {
              if ((event.target as HTMLElement).closest('a')) {
                setOpen(false)
              }
            }}>
              <SidebarNav sections={sections} pathname={pathname} />
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
