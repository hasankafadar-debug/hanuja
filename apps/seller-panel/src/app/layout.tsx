import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: {
    template: '%s | Hanuja Satıcı Paneli',
    default: 'Hanuja Satıcı Paneli',
  },
  description: 'Hanuja satıcı yönetim paneli.',
  robots: { index: false, follow: false },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="tr">
      <body>{children}</body>
    </html>
  )
}
