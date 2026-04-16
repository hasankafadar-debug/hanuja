import type { BrandConfig } from './brand.config'

/**
 * Hanuja default brand.
 *
 * Palette: deep navy + warm red accent — premium, curated, trustworthy.
 * Designed to work for the Hanuja marketplace template.
 *
 * Client swap: copy this file to {client-slug}.brand.ts and change values.
 * Run `pnpm new-client` to generate automatically.
 */
export const hanujaBrand: BrandConfig = {
  name: 'Hanuja',
  slug: 'hanuja',

  colors: {
    primary: '#1a1a2e',
    primaryFg: '#ffffff',

    secondary: '#16213e',
    secondaryFg: '#ffffff',

    accent: '#e94560',
    accentFg: '#ffffff',

    surface: '#ffffff',
    background: '#fafafa',

    border: '#e5e7eb',

    muted: '#f3f4f6',
    mutedFg: '#6b7280',

    destructive: '#ef4444',
    destructiveFg: '#ffffff',

    success: '#22c55e',
    warning: '#f59e0b',
  },

  typography: {
    fontSans: "'Inter', system-ui, sans-serif",
    fontDisplay: "'Playfair Display', 'Georgia', serif",
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
