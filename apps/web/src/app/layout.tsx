import type { Metadata } from 'next'
import '@fontsource/outfit/200.css'
import '@fontsource/outfit/300.css'
import '@fontsource/outfit/400.css'
import '@fontsource/outfit/500.css'
import '@fontsource/dm-sans/300.css'
import '@fontsource/dm-sans/400.css'
import '@fontsource/dm-sans/500.css'
import '@fontsource/plus-jakarta-sans/300.css'
import '@fontsource/plus-jakarta-sans/400.css'
import '@fontsource/plus-jakarta-sans/500.css'
import '@fontsource/plus-jakarta-sans/600.css'
import { Toaster } from '@hanuja/ui'
import { DEFAULT_WEB_URL } from '@hanuja/api/lib/platform-info'
import './globals.css'

const previewDeployment = process.env.PREVIEW_DEPLOYMENT === 'true'

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
    index: !previewDeployment,
    follow: !previewDeployment,
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="tr">
      <body>
        {children}
        <Toaster />
      </body>
    </html>
  )
}
