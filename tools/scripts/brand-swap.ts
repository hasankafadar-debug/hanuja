#!/usr/bin/env tsx
/**
 * Brand Swap Script
 *
 * Reads a brand config and automatically writes the :root CSS block
 * into all three apps' globals.css files.
 *
 * Usage:
 *   pnpm brand-swap                        # applies hanuja brand
 *   pnpm brand-swap --brand=moda-evi       # applies moda-evi.brand.ts
 *   pnpm brand-swap --brand=moda-evi --dry-run
 *
 * What it updates:
 *   apps/web/src/app/globals.css
 *   apps/seller-panel/src/app/globals.css
 *   apps/admin-panel/src/app/globals.css
 *
 * The script replaces the :root { ... } block between the markers:
 *   /* BRAND:START *\/
 *   :root { ... }
 *   /* BRAND:END *\/
 *
 * If markers are not found, the :root block is appended.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { BrandConfig } from '../../packages/config/brand/brand.config.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '../../')

const APP_GLOBALS_CSS = [
  'apps/web/src/app/globals.css',
  'apps/seller-panel/src/app/globals.css',
  'apps/admin-panel/src/app/globals.css',
]

const BRAND_START = '/* BRAND:START */'
const BRAND_END = '/* BRAND:END */'

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseArgs(): Record<string, string> {
  const args: Record<string, string> = {}
  for (const arg of process.argv.slice(2)) {
    const m = arg.match(/^--(\w[\w-]*)(?:=(.*))?$/)
    if (m) args[m[1] ?? ''] = m[2] ?? 'true'
  }
  return args
}

function brandToRootBlock(brand: BrandConfig): string {
  return [
    BRAND_START,
    ':root {',
    `  --color-primary: ${brand.colors.primary};`,
    `  --color-primary-fg: ${brand.colors.primaryFg};`,
    `  --color-secondary: ${brand.colors.secondary};`,
    `  --color-secondary-fg: ${brand.colors.secondaryFg};`,
    `  --color-accent: ${brand.colors.accent};`,
    `  --color-accent-fg: ${brand.colors.accentFg};`,
    `  --color-surface: ${brand.colors.surface};`,
    `  --color-background: ${brand.colors.background};`,
    `  --color-border: ${brand.colors.border};`,
    `  --color-muted: ${brand.colors.muted};`,
    `  --color-muted-fg: ${brand.colors.mutedFg};`,
    `  --color-destructive: ${brand.colors.destructive};`,
    `  --color-destructive-fg: ${brand.colors.destructiveFg};`,
    `  --color-success: ${brand.colors.success};`,
    `  --color-warning: ${brand.colors.warning};`,
    '',
    `  --font-sans: ${brand.typography.fontSans};`,
    `  --font-display: ${brand.typography.fontDisplay};`,
    `  --font-mono: ${brand.typography.fontMono};`,
    '',
    `  --radius-sm: ${brand.borderRadius.sm};`,
    `  --radius-md: ${brand.borderRadius.md};`,
    `  --radius-lg: ${brand.borderRadius.lg};`,
    `  --radius-xl: ${brand.borderRadius.xl};`,
    `  --radius-full: ${brand.borderRadius.full};`,
    '}',
    BRAND_END,
  ].join('\n')
}

function injectIntoGlobalsCss(cssPath: string, rootBlock: string, dryRun: boolean): 'updated' | 'appended' | 'dry-run' {
  const content = fs.existsSync(cssPath) ? fs.readFileSync(cssPath, 'utf-8') : ''

  let newContent: string
  if (content.includes(BRAND_START) && content.includes(BRAND_END)) {
    // Replace existing brand block
    const before = content.slice(0, content.indexOf(BRAND_START))
    const after = content.slice(content.indexOf(BRAND_END) + BRAND_END.length)
    newContent = `${before}${rootBlock}${after}`
    if (!dryRun) fs.writeFileSync(cssPath, newContent, 'utf-8')
    return dryRun ? 'dry-run' : 'updated'
  } else {
    // Append brand block at the end
    newContent = content.trimEnd() + '\n\n' + rootBlock + '\n'
    if (!dryRun) fs.writeFileSync(cssPath, newContent, 'utf-8')
    return dryRun ? 'dry-run' : 'appended'
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs()
  const brandSlug = args['brand'] ?? 'hanuja'
  const dryRun = args['dry-run'] === 'true'

  console.log(`\nHanuja Brand Swap`)
  console.log(`${'─'.repeat(40)}`)
  console.log(`Brand  : ${brandSlug}`)
  if (dryRun) console.log(`Mode   : DRY RUN (no files written)\n`)
  else console.log()

  const brandFilePath = path.join(repoRoot, 'packages/config/brand', `${brandSlug}.brand.ts`)

  if (!fs.existsSync(brandFilePath)) {
    console.error(`ERROR: Brand file not found: ${path.relative(repoRoot, brandFilePath)}`)
    console.error(`Run 'pnpm new-client --name="..." --primary="#..." --accent="#..."' first.`)
    process.exit(1)
  }

  let brandModule: Record<string, unknown>
  try {
    brandModule = await import(brandFilePath) as Record<string, unknown>
  } catch (err) {
    console.error(`ERROR: Failed to import brand file:`, err)
    process.exit(1)
  }

  const brand = Object.values(brandModule).find(
    (v) => v && typeof v === 'object' && 'colors' in (v as object) && 'typography' in (v as object),
  ) as BrandConfig | undefined

  if (!brand) {
    console.error(`ERROR: No valid BrandConfig export found in ${brandSlug}.brand.ts`)
    process.exit(1)
  }

  const rootBlock = brandToRootBlock(brand)

  let anyError = false
  for (const relPath of APP_GLOBALS_CSS) {
    const fullPath = path.join(repoRoot, relPath)
    try {
      const result = injectIntoGlobalsCss(fullPath, rootBlock, dryRun)
      const action = result === 'appended' ? 'appended' : result === 'dry-run' ? 'dry-run' : 'updated'
      console.log(`  OK  ${relPath}  [${action}]`)
    } catch (err) {
      console.error(`  ERR ${relPath}: ${err}`)
      anyError = true
    }
  }

  if (anyError) {
    console.error(`\nBrand swap completed with errors.\n`)
    process.exit(1)
  }

  if (dryRun) {
    console.log(`\nDry run complete — no files were modified.`)
    console.log(`Remove --dry-run to apply the brand swap.\n`)
  } else {
    console.log(`\nBrand swap complete for "${brand.name}".`)
    console.log(`\nNext steps:`)
    console.log(`  1. Update font imports in apps/*/src/app/layout.tsx if fonts changed`)
    console.log(`  2. Replace logo/favicon in apps/web/public/`)
    console.log(`  3. Run: pnpm dev — verify brand in browser\n`)
  }
}

main().catch((err) => {
  console.error('Brand swap failed:', err)
  process.exit(1)
})
