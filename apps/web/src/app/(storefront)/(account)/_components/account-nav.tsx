'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Bell, FileText, Heart, LogOut, MapPin, Package, User } from 'lucide-react'
import { signOut } from '@/lib/auth-client'

const ACCOUNT_NAV = [
  { label: 'Profilim', href: '/hesabim', icon: User },
  { label: 'Adreslerim', href: '/hesabim/adresler', icon: MapPin },
  { label: 'Favorilerim', href: '/hesabim/favoriler', icon: Heart },
  { label: 'İletişim Tercihleri', href: '/hesabim/iletisim-tercihleri', icon: Bell },
  { label: 'Faturalarım', href: '/faturalarim', icon: FileText },
  { label: 'Siparişlerim', href: '/siparis', icon: Package },
] as const

export function AccountNav() {
  const pathname = usePathname()
  const router = useRouter()

  async function handleSignOut() {
    try {
      await signOut()
    } finally {
      router.push('/giris')
      router.refresh()
    }
  }

  return (
    <nav className="flex flex-col gap-1">
      {ACCOUNT_NAV.map(({ label, href, icon: Icon }) => {
        const isActive = pathname === href
        return (
          <Link
            key={href}
            href={href}
            aria-current={isActive ? 'page' : undefined}
            className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors hover:bg-[var(--color-muted)]"
            style={{
              color: 'var(--color-primary)',
              backgroundColor: isActive ? 'var(--color-muted)' : undefined,
            }}
          >
            <Icon className="h-4 w-4 shrink-0" style={{ color: 'var(--color-muted-fg)' }} />
            {label}
          </Link>
        )
      })}

      <button
        type="button"
        onClick={() => void handleSignOut()}
        className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors hover:bg-[var(--color-muted)]"
        style={{ color: 'var(--color-primary)' }}
      >
        <LogOut className="h-4 w-4 shrink-0" style={{ color: 'var(--color-muted-fg)' }} />
        Çıkış Yap
      </button>
    </nav>
  )
}
