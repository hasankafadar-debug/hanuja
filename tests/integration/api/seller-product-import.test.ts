import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// ab0c31c deliberately removed seller URL scraping/import and its permission UI.
// The former six endpoint tests exercised deleted product behavior. Keep the
// retired surface closed; current file-import behavior is covered separately by
// seller-bulk-import.test.ts and bulk-product-import.test.ts.
describe('retired seller URL import surface', () => {
  it.each(['preview', 'commit', 'request'])('does not expose the retired %s endpoint', endpoint => {
    expect(existsSync(resolve(__dirname,
      `../../../apps/seller-panel/src/app/api/seller/products/import/${endpoint}/route.ts`))).toBe(false)
  })
  it('does not expose the retired URL import page', () => {
    expect(existsSync(resolve(__dirname,
      '../../../apps/seller-panel/src/app/(panel)/urunler/ice-aktar/page.tsx'))).toBe(false)
  })
})