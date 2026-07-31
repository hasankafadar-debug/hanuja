import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { AccountNav } from './_components/account-nav'

export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const requestHeaders = await headers()
  const session = await auth.api.getSession({ headers: requestHeaders })
  if (!session?.user) {
    const pathname = requestHeaders.get('x-hanuja-pathname') ?? '/hesabim'
    redirect(`/giris?callbackUrl=${encodeURIComponent(pathname)}`)
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="grid grid-cols-1 gap-8 md:grid-cols-4">
        {/* Sidebar nav */}
        <aside className="md:col-span-1">
          <AccountNav />
        </aside>

        {/* Content */}
        <main className="md:col-span-3">
          {children}
        </main>
      </div>
    </div>
  )
}
