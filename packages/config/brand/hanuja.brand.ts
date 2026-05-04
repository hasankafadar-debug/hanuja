import type { BrandConfig } from './brand.config'

/**
 * Hanuja default brand.
 *
 * Palette: dark charcoal + warm cream + golden-beige — curated, premium, trustworthy.
 * Designed to work for the Hanuja marketplace template.
 *
 * Client swap: copy this file to {client-slug}.brand.ts and change values.
 * Run `pnpm new-client` to generate automatically.
 */
export const hanujaBrand: BrandConfig = {
  name: 'Hanuja',
  slug: 'hanuja',

  colors: {
    // DARK (#1a1a18) — koyu zemin / primary metin rengi
    primary: '#1a1a18',
    // CREAM (#e8e2d4) — koyu zemin üstünde ön plan (logo, header metni)
    primaryFg: '#e8e2d4',

    // MID (#9c8e7a) — ikincil metin / şerit
    secondary: '#9c8e7a',
    secondaryFg: '#1a1a18',

    // TAN (#c8b89a) — altın-bej vurgu
    accent: '#c8b89a',
    accentFg: '#1a1a18',

    // Çok açık krem — kart / bileşen arkaplanı
    surface: '#f0eee9',
    // Krem — sayfa arkaplanı
    background: '#e8e2d4',

    // Kremin bir ton koyusu
    border: '#d6cfbe',

    muted: '#ede7d8',
    mutedFg: '#9c8e7a',

    destructive: '#dc2626',
    destructiveFg: '#ffffff',

    success: '#16a34a',
    warning: '#d97706',
  },

  typography: {
    // Menü, buton, fiyat, etiket
    fontSans: "'Outfit', system-ui, sans-serif",
    // Gövde, paragraf, açıklama
    fontBody: "'DM Sans', system-ui, sans-serif",
    // Ürün başlığı, editoryal, hero
    fontDisplay: "'Cormorant Garamond', Georgia, serif",
    fontMono: "'JetBrains Mono', 'Fira Code', monospace",
  },

  borderRadius: {
    sm: '4px',
    md: '8px',
    lg: '12px',
    xl: '16px',
    full: '9999px',
  },
}
