import type { Metadata } from 'next'

export const metadata: Metadata = {
  robots: { index: false },
}

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-50 px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <span className="text-2xl font-semibold tracking-tight text-neutral-900">
            Hanuja
          </span>
          <p className="text-sm text-neutral-500 mt-1">Satıcı Paneli</p>
        </div>
        {children}
      </div>
    </div>
  )
}
