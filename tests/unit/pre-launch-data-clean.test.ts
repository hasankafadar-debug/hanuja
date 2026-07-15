import { describe, expect, it } from 'vitest'
import {
  databaseNameFromUrl,
  parseMode,
  sanitizeCmsHref,
} from '../../tools/scripts/pre-launch-data-clean'

describe('pre-launch cleanup safety', () => {
  it('requires exactly one non-conflicting mode', () => {
    const scope = [
      '--seller-ids=seller-1,seller-2,seller-3',
      '--expect-sellers=3',
      '--expect-products=19',
      '--expect-orders=19',
    ]
    expect(parseMode([])).toBeNull()
    expect(parseMode(['--confirm'])).toBeNull()
    expect(parseMode(['--dry-run', '--confirm=hanuja_prod', ...scope])).toBeNull()
    expect(parseMode(['--dry-run', '--dry-run', ...scope])).toBeNull()
    expect(parseMode(['--unknown'])).toBeNull()
    expect(parseMode(['--dry-run'])).toBeNull()
    expect(parseMode(['--dry-run', ...scope])).toEqual({
      kind: 'dry-run',
      sellerIds: ['seller-1', 'seller-2', 'seller-3'],
      sellers: 3,
      products: 19,
      orders: 19,
    })
    expect(parseMode(['--confirm=hanuja_prod', ...scope])).toEqual({
      kind: 'confirm',
      databaseName: 'hanuja_prod',
      sellerIds: ['seller-1', 'seller-2', 'seller-3'],
      sellers: 3,
      products: 19,
      orders: 19,
    })
  })

  it('extracts the exact database name without exposing credentials', () => {
    expect(databaseNameFromUrl('postgresql://secret:secret@db:5432/hanuja_prod?sslmode=require')).toBe('hanuja_prod')
  })

  it('deactivates stale product/store CMS links', () => {
    expect(sanitizeCmsHref('/urun/demo-koltuk')).toEqual({ href: '/', active: false })
    expect(sanitizeCmsHref('/magaza/demo')).toEqual({ href: '/', active: false })
    expect(sanitizeCmsHref('/kategori/mobilya')).toEqual({ href: '/kategori/mobilya', active: true })
  })
})
