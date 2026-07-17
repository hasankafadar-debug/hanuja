import type { Metadata } from 'next'
import '@fontsource/outfit/300.css'
import '@fontsource/outfit/400.css'
import '@fontsource/outfit/500.css'
import '@fontsource/dm-sans/300.css'
import '@fontsource/dm-sans/400.css'
import '@fontsource/dm-sans/500.css'
import './globals.css'

export const metadata: Metadata = {
  title: {
    template: '%s | Hanuja Satıcı Paneli',
    default: 'Hanuja Satıcı Paneli',
  },
  description: 'Hanuja satıcı yönetim paneli.',
  icons: { icon: '/favicon.svg', shortcut: '/favicon.svg' },
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
