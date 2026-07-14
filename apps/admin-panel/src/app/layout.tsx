import type { Metadata } from 'next'
import { Outfit, DM_Sans } from 'next/font/google'
import './globals.css'

const outfit = Outfit({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-sans',
  display: 'swap',
  weight: ['300', '400', '500'],
})

const dmSans = DM_Sans({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-body',
  display: 'swap',
  weight: ['300', '400', '500'],
})

export const metadata: Metadata = {
  title: {
    template: '%s | Hanuja Admin',
    default: 'Hanuja Admin Paneli',
  },
  description: 'Hanuja yönetim paneli.',
  icons: { icon: '/favicon.svg', shortcut: '/favicon.svg' },
  robots: { index: false, follow: false },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="tr" className={`${outfit.variable} ${dmSans.variable}`}>
      <body>{children}</body>
    </html>
  )
}
