---
name: design-token-flow
description: Apply Hanuja design token and brand system rules. Use when configuring brand colors, typography, Tailwind theme, CSS custom properties, or implementing the client brand swap mechanism.
user-invocable: false
paths:
  - "packages/config/brand/**/*"
  - "packages/config/tailwind/**/*"
  - "apps/*/src/app/globals.css"
  - "tools/generators/**/*"
model: sonnet
effort: medium
---

This skill defines Hanuja design token and brand system discipline.

Main principle:
All visual values (colors, fonts, spacing, radius) must flow from the brand configuration, never be hardcoded in components. This enables client brand swap by changing only brand config files.

Brand config interface (TypeScript):
```typescript
interface BrandConfig {
  name: string
  colors: {
    primary: string      // Main brand color (hex)
    primaryFg: string    // Text on primary background
    secondary: string    // Secondary accent
    secondaryFg: string
    accent: string       // Highlight/call-to-action
    accentFg: string
    surface: string      // Card/panel background
    background: string   // Page background
    border: string       // Default border color
    muted: string        // Muted text
    mutedFg: string
    destructive: string  // Error/danger color
    destructiveFg: string
    success: string
    warning: string
  }
  typography: {
    fontSans: string     // Body font family (Google Fonts name)
    fontDisplay: string  // Heading font family
    fontMono: string     // Code font family
  }
  borderRadius: {
    sm: string           // e.g. '4px'
    md: string
    lg: string
    xl: string
    full: string
  }
  spacing: {
    unit: number         // Base spacing unit in px (default: 4)
  }
}
```

CSS custom properties pattern (globals.css):
All tokens become CSS variables on :root:
```css
:root {
  --color-primary: {brand.colors.primary};
  --color-primary-fg: {brand.colors.primaryFg};
  --font-sans: {brand.typography.fontSans};
  --radius-md: {brand.borderRadius.md};
}
```

Tailwind theme extension pattern:
```typescript
// tailwind/preset.ts
export function createTailwindPreset(brand: BrandConfig) {
  return {
    theme: {
      extend: {
        colors: {
          primary: 'var(--color-primary)',
          'primary-fg': 'var(--color-primary-fg)',
          // ...
        },
        fontFamily: {
          sans: ['var(--font-sans)', 'sans-serif'],
          display: ['var(--font-display)', 'sans-serif'],
        },
        borderRadius: {
          sm: 'var(--radius-sm)',
          md: 'var(--radius-md)',
          // ...
        }
      }
    }
  }
}
```

Hanuja default brand (neutral/placeholder):
- Primary: #1a1a2e (deep navy)
- Secondary: #16213e
- Accent: #e94560 (warm red)
- Background: #fafafa
- Surface: #ffffff
- Font: Inter (sans), Playfair Display (display)

Client brand swap process:
1. `pnpm new-client --name="ClientName"` runs tools/generators/new-client.ts
2. Script creates packages/config/brand/{client-slug}.brand.ts
3. Apps import from environment-configurable brand file
4. CSS custom properties regenerated from new brand
5. Google Fonts import updated for new font family

Component usage rules:
- All components use Tailwind classes with CSS variable colors
- No hardcoded hex values in component files
- State colors (success, warning, destructive) from brand tokens
- Dark mode: use CSS variable overrides on [data-theme="dark"] if needed

When implementing design tokens:
- always route color through brand config first
- test brand swap by temporarily changing primary color
- verify all components update without code changes
- keep brand config simple — don't over-engineer color system

Never accept:
- hardcoded colors in component files (e.g., className="bg-[#e94560]")
- font families hardcoded in components
- design decisions that break when brand changes
- multiple competing color systems in the same codebase
