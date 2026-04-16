import type { Metadata } from 'next'
import { Inter, Playfair_Display } from 'next/font/google'
import { Toaster } from '@hanuja/ui'
import './globals.css'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
})

const playfair = Playfair_Display({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
})

export const metadata: Metadata = {
  title: {
    template: '%s | Hanuja',
    default: 'Hanuja — Ev, Ofis & Yaşam Ürünleri',
  },
  description: "Türkiye'nin ev, ofis ve yaşam ürünleri marketplace'i.",
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? 'https://hanuja.com'),
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
    <html lang="tr" className={`${inter.variable} ${playfair.variable}`}>
      <body>
        {children}
        <Toaster />
      </body>
    </html>
  )
}
