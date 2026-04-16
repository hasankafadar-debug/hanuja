import Link from 'next/link'
import { User, MapPin, Package, LogOut } from 'lucide-react'

const ACCOUNT_NAV = [
  { label: 'Profilim', href: '/hesabim', icon: User },
  { label: 'Adreslerim', href: '/hesabim/adresler', icon: MapPin },
  { label: 'Siparişlerim', href: '/siparis', icon: Package },
  { label: 'Çıkış Yap', href: '/giris', icon: LogOut },
]

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="grid grid-cols-1 gap-8 md:grid-cols-4">
        {/* Sidebar nav */}
        <aside className="md:col-span-1">
          <nav className="flex flex-col gap-1">
            {ACCOUNT_NAV.map(({ label, href, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors hover:bg-[var(--color-muted)]"
                style={{ color: 'var(--color-primary)' }}
              >
                <Icon className="h-4 w-4 shrink-0" style={{ color: 'var(--color-muted-fg)' }} />
                {label}
              </Link>
            ))}
          </nav>
        </aside>

        {/* Content */}
        <main className="md:col-span-3">
          {children}
        </main>
      </div>
    </div>
  )
}
