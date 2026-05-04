/**
 * BrandConfig — Hanuja marketplace brand interface.
 *
 * All visual tokens (colors, fonts, radius) flow from this config.
 * To create a new client marketplace: implement this interface and swap the import.
 * Components never hardcode color values — they read CSS custom properties
 * that are generated from this config via injectBrandTokens().
 *
 * See: .claude/skills/design-token-flow/SKILL.md
 */
export interface BrandConfig {
  /** Marketplace display name */
  name: string
  /** URL-safe identifier for this brand (used in file names, slugs) */
  slug: string

  colors: {
    /** Main brand color — used for primary buttons, links, key accents */
    primary: string
    /** Text/icon color on primary background */
    primaryFg: string

    /** Secondary brand color — used for secondary surfaces */
    secondary: string
    secondaryFg: string

    /** Call-to-action accent — used for highlights, badges, hover states */
    accent: string
    accentFg: string

    /** Card and panel background */
    surface: string
    /** Page body background */
    background: string

    /** Default border/divider color */
    border: string

    /** Muted background (chips, subtle areas) */
    muted: string
    /** Text on muted background */
    mutedFg: string

    /** Error/danger color — reserved for destructive meaning only */
    destructive: string
    destructiveFg: string

    /** Positive/success state */
    success: string
    /** Warning/caution state */
    warning: string
  }

  typography: {
    /** Primary sans font — used for menus, buttons, prices, labels (Outfit) */
    fontSans: string
    /** Body/paragraph font — used for body text, descriptions (DM Sans) */
    fontBody?: string
    /** Display/heading font — used for product titles, editorial (Cormorant Garamond) */
    fontDisplay: string
    /** Monospace font — used for code, tracking numbers */
    fontMono: string
  }

  borderRadius: {
    sm: string
    md: string
    lg: string
    xl: string
    full: string
  }
}

/**
 * Generates CSS custom property declarations from a BrandConfig.
 * Used in globals.css :root block or injected server-side.
 */
export function brandToCssVars(brand: BrandConfig): Record<string, string> {
  return {
    '--color-primary': brand.colors.primary,
    '--color-primary-fg': brand.colors.primaryFg,
    '--color-secondary': brand.colors.secondary,
    '--color-secondary-fg': brand.colors.secondaryFg,
    '--color-accent': brand.colors.accent,
    '--color-accent-fg': brand.colors.accentFg,
    '--color-surface': brand.colors.surface,
    '--color-background': brand.colors.background,
    '--color-border': brand.colors.border,
    '--color-muted': brand.colors.muted,
    '--color-muted-fg': brand.colors.mutedFg,
    '--color-destructive': brand.colors.destructive,
    '--color-destructive-fg': brand.colors.destructiveFg,
    '--color-success': brand.colors.success,
    '--color-warning': brand.colors.warning,
    '--font-sans': brand.typography.fontSans,
    '--font-body': brand.typography.fontBody ?? brand.typography.fontSans,
    '--font-display': brand.typography.fontDisplay,
    '--font-mono': brand.typography.fontMono,
    '--radius-sm': brand.borderRadius.sm,
    '--radius-md': brand.borderRadius.md,
    '--radius-lg': brand.borderRadius.lg,
    '--radius-xl': brand.borderRadius.xl,
    '--radius-full': brand.borderRadius.full,
  }
}

/**
 * Renders CSS :root block string from a BrandConfig.
 * Used by the new-client generator to write globals.css.
 */
export function brandToRootCss(brand: BrandConfig): string {
  const vars = brandToCssVars(brand)
  const lines = Object.entries(vars)
    .map(([key, value]) => `  ${key}: ${value};`)
    .join('\n')
  return `:root {\n${lines}\n}`
}
