import type { Config } from 'tailwindcss'

/**
 * Hanuja Tailwind preset.
 *
 * All color values reference CSS custom properties — set by brand config at :root.
 * This means Tailwind classes like `bg-primary` will always read from the active brand,
 * enabling client brand swap without any component code changes.
 *
 * Usage in app tailwind.config.ts:
 *   import { hanujaPreset } from '@hanuja/config/tailwind/preset'
 *   export default { presets: [hanujaPreset], content: [...] }
 *
 * See: .claude/skills/design-token-flow/SKILL.md
 */
export const hanujaPreset: Config = {
  content: [],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: 'var(--color-primary)',
          fg: 'var(--color-primary-fg)',
        },
        secondary: {
          DEFAULT: 'var(--color-secondary)',
          fg: 'var(--color-secondary-fg)',
        },
        accent: {
          DEFAULT: 'var(--color-accent)',
          fg: 'var(--color-accent-fg)',
        },
        surface: 'var(--color-surface)',
        border: 'var(--color-border)',
        muted: {
          DEFAULT: 'var(--color-muted)',
          fg: 'var(--color-muted-fg)',
        },
        destructive: {
          DEFAULT: 'var(--color-destructive)',
          fg: 'var(--color-destructive-fg)',
        },
        success: 'var(--color-success)',
        warning: 'var(--color-warning)',
      },
      fontFamily: {
        sans: ['var(--font-sans)'],
        display: ['var(--font-display)'],
        mono: ['var(--font-mono)'],
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        DEFAULT: 'var(--radius-md)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
        full: 'var(--radius-full)',
      },
    },
  },
  plugins: [],
}
