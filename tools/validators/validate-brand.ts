#!/usr/bin/env tsx
/**
 * Brand Config Validator
 *
 * Validates that a brand config file is complete, correctly typed,
 * and all color values are valid hex codes.
 *
 * Usage:
 *   pnpm validate-brand                        # validates hanuja.brand.ts
 *   pnpm validate-brand --brand=moda-evi       # validates moda-evi.brand.ts
 *
 * Exit codes:
 *   0 — brand config is valid
 *   1 — validation failed
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '../../')

// ── Helpers ───────────────────────────────────────────────────────────────────

function isValidHex(value: string): boolean {
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value.trim())
}

function parseArgs(): Record<string, string> {
  const args: Record<string, string> = {}
  for (const arg of process.argv.slice(2)) {
    const match = arg.match(/^--(\w[\w-]*)(?:=(.*))?$/)
    if (match) args[match[1] ?? ''] = match[2] ?? 'true'
  }
  return args
}

// ── Validation ────────────────────────────────────────────────────────────────

interface ValidationError {
  field: string
  message: string
}

function validateBrandObject(brand: Record<string, unknown>): ValidationError[] {
  const errors: ValidationError[] = []

  // Top-level required fields
  if (!brand['name'] || typeof brand['name'] !== 'string' || (brand['name'] as string).trim() === '') {
    errors.push({ field: 'name', message: 'Brand name is required and must be a non-empty string' })
  }
  if (!brand['slug'] || typeof brand['slug'] !== 'string' || !/^[a-z0-9-]+$/.test(brand['slug'] as string)) {
    errors.push({ field: 'slug', message: 'Brand slug must be a lowercase alphanumeric string with hyphens' })
  }

  // Colors
  const colors = brand['colors'] as Record<string, unknown> | undefined
  if (!colors || typeof colors !== 'object') {
    errors.push({ field: 'colors', message: 'colors object is required' })
  } else {
    const requiredColors = [
      'primary', 'primaryFg', 'secondary', 'secondaryFg',
      'accent', 'accentFg', 'surface', 'background',
      'border', 'muted', 'mutedFg',
      'destructive', 'destructiveFg', 'success', 'warning',
    ]
    for (const key of requiredColors) {
      const val = colors[key]
      if (!val || typeof val !== 'string') {
        errors.push({ field: `colors.${key}`, message: `colors.${key} is required` })
      } else if (!isValidHex(val)) {
        errors.push({ field: `colors.${key}`, message: `colors.${key} must be a valid hex color, got: "${val}"` })
      }
    }

    // Contrast sanity: primaryFg should not equal primary
    if (colors['primary'] === colors['primaryFg']) {
      errors.push({ field: 'colors.primaryFg', message: 'primaryFg and primary should not be identical (no contrast)' })
    }
  }

  // Typography
  const typography = brand['typography'] as Record<string, unknown> | undefined
  if (!typography || typeof typography !== 'object') {
    errors.push({ field: 'typography', message: 'typography object is required' })
  } else {
    for (const key of ['fontSans', 'fontDisplay', 'fontMono']) {
      const val = typography[key]
      if (!val || typeof val !== 'string' || (val as string).trim() === '') {
        errors.push({ field: `typography.${key}`, message: `typography.${key} is required` })
      }
    }
  }

  // Border radius
  const radius = brand['borderRadius'] as Record<string, unknown> | undefined
  if (!radius || typeof radius !== 'object') {
    errors.push({ field: 'borderRadius', message: 'borderRadius object is required' })
  } else {
    for (const key of ['sm', 'md', 'lg', 'xl', 'full']) {
      const val = radius[key]
      if (!val || typeof val !== 'string') {
        errors.push({ field: `borderRadius.${key}`, message: `borderRadius.${key} is required` })
      }
    }
  }

  return errors
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs()
  const brandSlug = args['brand'] ?? 'hanuja'
  const brandFilePath = path.join(repoRoot, 'packages/config/brand', `${brandSlug}.brand.ts`)

  console.log(`\nHanuja Brand Validator`)
  console.log(`${'─'.repeat(40)}`)
  console.log(`Validating: ${path.relative(repoRoot, brandFilePath)}\n`)

  if (!fs.existsSync(brandFilePath)) {
    console.error(`ERROR: Brand file not found: ${brandFilePath}`)
    console.error(`Run 'pnpm new-client' to generate a new brand config.`)
    process.exit(1)
  }

  // Dynamic import to load the brand module
  let brandModule: Record<string, unknown>
  try {
    brandModule = await import(brandFilePath) as Record<string, unknown>
  } catch (err) {
    console.error(`ERROR: Failed to import brand file:`, err)
    process.exit(1)
  }

  // Find the exported brand object (any export ending with 'Brand' or 'brand')
  const brandExport = Object.values(brandModule).find(
    (v) => v && typeof v === 'object' && 'name' in (v as object) && 'colors' in (v as object),
  ) as Record<string, unknown> | undefined

  if (!brandExport) {
    console.error(`ERROR: No valid BrandConfig export found in the brand file.`)
    console.error(`Make sure you export a BrandConfig object (e.g. export const hanujaBrand: BrandConfig = {...})`)
    process.exit(1)
  }

  const errors = validateBrandObject(brandExport)

  if (errors.length === 0) {
    console.log(`OK  Brand config is valid`)
    console.log(`    Name  : ${String(brandExport['name'])}`)
    console.log(`    Slug  : ${String(brandExport['slug'])}`)
    const colors = brandExport['colors'] as Record<string, string>
    console.log(`    Primary  : ${colors['primary']}`)
    console.log(`    Accent   : ${colors['accent']}`)
    console.log(`\nBrand validation passed.\n`)
    process.exit(0)
  } else {
    console.error(`FAIL  Brand config has ${errors.length} error(s):\n`)
    for (const err of errors) {
      console.error(`  [${err.field}] ${err.message}`)
    }
    console.error(`\nBrand validation failed. Fix the above errors and re-run.\n`)
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('Validator crashed:', err)
  process.exit(1)
})
