/**
 * Integration test — product moderation decision flow.
 *
 * Mirrors the decision rule used by api/services/catalog.service.ts
 * `getModerationDecision`: scanner findings + AUTO_APPROVE_CLEAN_PRODUCTS
 * env flag combine to produce status + moderationFindings.
 *
 * The rule is small enough that replicating it here (in line with the rest
 * of the integration suite, which exercises domain rules without a real
 * Prisma client) gives meaningful regression coverage. If the rule diverges
 * from catalog.service, this test will not catch it directly — the security
 * value is in pinning the rule shape.
 *
 * Three scenarios:
 *  1. Flagged content → pending_review with findings populated.
 *  2. Clean content, flag off → pending_review with no findings.
 *  3. Clean content, flag on  → published with no findings.
 *
 * .claude/rules/06-content-guidelines.md, .claude/rules/10-admin-panel-rules.md
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createContentScannerService } from '../../api/services/content-scanner.service'

type ProductStatus = 'pending_review' | 'published'

// Mirror of getModerationDecision in api/services/catalog.service.ts.
// Keep this in lockstep with the service when the rule changes.
function decideModeration(input: {
  name: string
  description?: string | null
  shortDescription?: string | null
  story?: string | null
  careInstructions?: string | null
}): { status: ProductStatus; moderationFindings: unknown } {
  const scanner = createContentScannerService()
  const scan = scanner.scanProductContent(input)
  if (scan.flagged) {
    return { status: 'pending_review', moderationFindings: scan.findings }
  }
  return {
    status: process.env['AUTO_APPROVE_CLEAN_PRODUCTS'] === 'true' ? 'published' : 'pending_review',
    moderationFindings: null,
  }
}

const FLAGGED_INPUT = {
  name: 'El yapımı sehpa',
  description: 'Detay için 0555 123 45 67 üzerinden ulaşın.',
}

const CLEAN_INPUT = {
  name: 'Masif meşe orta sehpa',
  description: 'Doğal yağ ile korunan, salon kullanımına uygun el yapımı orta sehpa.',
  shortDescription: 'Mat vernikli yüzey',
  story: 'Her parça damar yapısına göre tek tek seçilir.',
  careInstructions: 'Nemli bezle silin, direkt güneşte uzun süre bırakmayın.',
}

describe('product moderation flow — content scanner + auto-approve flag', () => {
  const previousFlag = process.env['AUTO_APPROVE_CLEAN_PRODUCTS']

  beforeEach(() => {
    delete process.env['AUTO_APPROVE_CLEAN_PRODUCTS']
  })

  afterEach(() => {
    if (previousFlag === undefined) {
      delete process.env['AUTO_APPROVE_CLEAN_PRODUCTS']
    } else {
      process.env['AUTO_APPROVE_CLEAN_PRODUCTS'] = previousFlag
    }
  })

  it('flagged content → pending_review with findings even when auto-approve flag is on', () => {
    process.env['AUTO_APPROVE_CLEAN_PRODUCTS'] = 'true'
    const result = decideModeration(FLAGGED_INPUT)

    expect(result.status).toBe('pending_review')
    expect(Array.isArray(result.moderationFindings)).toBe(true)
    const findings = result.moderationFindings as Array<{ type: string }>
    expect(findings.some((f) => f.type === 'phone')).toBe(true)
  })

  it('clean content + flag off → pending_review with no findings (default behaviour)', () => {
    const result = decideModeration(CLEAN_INPUT)

    expect(result.status).toBe('pending_review')
    expect(result.moderationFindings).toBeNull()
  })

  it('clean content + flag on → published with no findings', () => {
    process.env['AUTO_APPROVE_CLEAN_PRODUCTS'] = 'true'
    const result = decideModeration(CLEAN_INPUT)

    expect(result.status).toBe('published')
    expect(result.moderationFindings).toBeNull()
  })

  it('flagged content with flag off still pending_review (regression on default path)', () => {
    const result = decideModeration(FLAGGED_INPUT)

    expect(result.status).toBe('pending_review')
    const findings = result.moderationFindings as Array<{ type: string }>
    expect(findings.length).toBeGreaterThan(0)
  })
})
