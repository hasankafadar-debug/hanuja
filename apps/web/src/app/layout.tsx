import type { Metadata } from 'next'
import { Outfit, DM_Sans, Plus_Jakarta_Sans } from 'next/font/google'
import { Toaster } from '@hanuja/ui'
import { DEFAULT_WEB_URL } from '@hanuja/api/lib/platform-info'
import './globals.css'

const outfit = Outfit({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-sans',
  display: 'swap',
  weight: ['200', '300', '400', '500'],
})

const dmSans = DM_Sans({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-body',
  display: 'swap',
  weight: ['300', '400', '500'],
})

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-display',
  display: 'swap',
  weight: ['300', '400', '500', '600'],
})

export const metadata: Metadata = {
  title: {
    template: '%s | Hanuja',
    default: 'Hanuja — Ev, Ofis & Yaşam Ürünleri',
  },
  description: "Türkiye'nin ev, ofis ve yaşam ürünleri marketplace'i.",
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? DEFAULT_WEB_URL),
  icons: {
    icon: '/favicon.svg',
    shortcut: '/favicon.svg',
  },
  openGraph: {
    siteName: 'Hanuja',
    locale: 'tr_TR',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
  },
  robots: {
    index: true,
    follow: true,
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="tr" className={`${outfit.variable} ${dmSans.variable} ${plusJakarta.variable}`}>
      <body>
        {children}
        <Toaster />
      </body>
    </html>
  )
}
