import type { ReactNode } from 'react'

export default function LegalLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
      <div
        className="prose prose-sm max-w-none"
        style={{
          '--tw-prose-headings': 'var(--color-primary)',
          '--tw-prose-body': 'var(--color-fg)',
          '--tw-prose-bold': 'var(--color-fg)',
        } as React.CSSProperties}
      >
        {children}
      </div>
    </div>
  )
}
