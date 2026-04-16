import type { Metadata } from 'next'

export const metadata: Metadata = {
  robots: { index: false, follow: false },
}

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-100 px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <span className="text-xl font-semibold tracking-tight text-neutral-900">
            Hanuja
          </span>
          <p className="text-xs text-neutral-400 mt-1 uppercase tracking-widest">Admin</p>
        </div>
        {children}
      </div>
    </div>
  )
}
