/**
 * Regression tests for the admin dashboard's action-card highlighting.
 *
 * The page computes attention from raw numeric counters. Formatted values are
 * intentionally not parsed, and Active Seller remains the sole exception.
 */
import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const DASHBOARD_PAGE = fileURLToPath(
  new URL('../../apps/admin-panel/src/app/(panel)/dashboard/page.tsx', import.meta.url),
)
const STAT_CARD = fileURLToPath(new URL('../../packages/ui/src/components/composite/stat-card.tsx', import.meta.url))

describe('admin dashboard attention cards', () => {
  it('highlights 15 non-zero metrics and excludes Active Seller', async () => {
    const source = await readFile(DASHBOARD_PAGE, 'utf8')
    const expressions = [...source.matchAll(/attention:\s*([\s\S]*?),\s*\r?\n\s*icon:/g)].map((match) =>
      match[1]?.replace(/\s+/g, ' ').trim(),
    )

    expect(expressions).toHaveLength(16)
    expect(expressions.filter((expression) => expression === 'false')).toHaveLength(1)
    expect(
      expressions.filter((expression) => expression !== 'false').every((expression) => expression?.endsWith('> 0')),
    ).toBe(true)

    const activeSellerStart = source.indexOf("title: 'Aktif Satıcı'")
    const activeSellerEnd = source.indexOf('},', activeSellerStart)
    expect(activeSellerStart).toBeGreaterThan(-1)
    expect(source.slice(activeSellerStart, activeSellerEnd)).toContain('attention: false')
    expect(source).toContain("tone={card.attention ? 'attention' : 'default'}")
  })

  it('renders the attention tone with a visible and accessible signal', async () => {
    const source = await readFile(STAT_CARD, 'utf8')

    expect(source).toContain('tone?: "default" | "attention"')
    expect(source).toContain('border-[#86efac] bg-[#f0fdf4]')
    expect(source).toContain('bg-[#dcfce7] text-success')
    expect(source).toContain('<span className="sr-only">İşlem bekliyor</span>')
  })
})
