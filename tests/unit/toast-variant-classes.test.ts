/**
 * Regression tests for the storefront toast colors.
 *
 * The toast variants used `bg-success/10`, `border-success/30` and `text-success-fg`.
 * The Tailwind preset declares colors as bare `var(--color-*)` without an
 * `<alpha-value>` placeholder, so those classes were never generated and the
 * "Sepete eklendi" toast rendered with a transparent background on top of the
 * header. These tests compile the real classes with the real preset.
 */
import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { hanujaPreset } from '../../packages/config/tailwind/preset'

const TOAST = fileURLToPath(new URL('../../packages/ui/src/components/toast.tsx', import.meta.url))
const CART_FLYOUT = fileURLToPath(
  new URL('../../apps/web/src/components/cart-added-flyout.tsx', import.meta.url),
)

// tailwindcss and postcss are dependencies of the web app, not of the test package.
const webRequire = createRequire(new URL('../../apps/web/package.json', import.meta.url))
const tailwindcss = webRequire('tailwindcss')
const postcss = webRequire('postcss')

async function generatesCss(className: string): Promise<boolean> {
  const result = await postcss([
    tailwindcss({
      presets: [hanujaPreset],
      content: [{ raw: `<div class="${className}"></div>` }],
      corePlugins: { preflight: false },
    }),
  ]).process('@tailwind utilities;', { from: undefined })
  return result.css.trim().length > 0
}

function variantClasses(source: string): string[] {
  const block = source.slice(source.indexOf('variants: {'), source.indexOf('defaultVariants'))
  return [...block.matchAll(/(?:default|success|destructive|warning):\s*"([^"]+)"/g)].flatMap(
    (match) => (match[1] ?? '').split(/\s+/).filter(Boolean),
  )
}

function titleToneClasses(source: string): string[] {
  const block = source.slice(source.indexOf('const TOAST_TITLE_TONE'), source.indexOf('function Toaster'))
  return [...block.matchAll(/className:\s*"([^"]+)"/g)].flatMap((match) =>
    (match[1] ?? '').split(/\s+/).filter(Boolean),
  )
}

const UNSUPPORTED_COLOR_CLASS = /\b(?:bg|border|text)-(?:success|warning|destructive|info)(?:\/\d+|-fg)\b/

// The explanatory comments name the broken classes; only code is checked.
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

describe('toast colors', () => {
  it('generates CSS for every variant class', async () => {
    const source = await readFile(TOAST, 'utf8')
    const classes = variantClasses(source)

    expect(classes).toEqual(expect.arrayContaining(['bg-white', 'border-success', 'border-destructive']))
    for (const className of classes) {
      expect(await generatesCss(className), className).toBe(true)
    }
  })

  it('generates CSS for every title tone class', async () => {
    const source = await readFile(TOAST, 'utf8')
    const classes = titleToneClasses(source)

    expect(classes.length).toBeGreaterThan(0)
    for (const className of classes) {
      expect(await generatesCss(className), className).toBe(true)
    }
  })

  it('does not use opacity modifiers or -fg names on preset state colors', async () => {
    for (const file of [TOAST, CART_FLYOUT]) {
      const source = withoutComments(await readFile(file, 'utf8'))
      expect(source, file).not.toMatch(UNSUPPORTED_COLOR_CLASS)
    }
  })

  it('confirms the preset really drops opacity modifiers (why the rule above exists)', async () => {
    expect(await generatesCss('bg-success/10')).toBe(false)
    expect(await generatesCss('bg-success')).toBe(true)
  })
})
