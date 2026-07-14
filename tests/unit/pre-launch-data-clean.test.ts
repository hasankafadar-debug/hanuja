import { describe, expect, it } from 'vitest'
import {
  databaseNameFromUrl,
  parseMode,
  sanitizeCmsHref,
} from '../../tools/scripts/pre-launch-data-clean'

describe('pre-launch cleanup safety', () => {
  it('requires exactly one non-conflicting mode', () => {
    expect(parseMode([])).toBeNull()
    expect(parseMode(['--confirm'])).toBeNull()
    expect(parseMode(['--dry-run', '--confirm=hanuja_prod'])).toBeNull()
    expect(parseMode(['--dry-run', '--dry-run'])).toBeNull()
    expect(parseMode(['--unknown'])).toBeNull()
    expect(parseMode(['--dry-run'])).toEqual({ kind: 'dry-run' })
    expect(parseMode(['--confirm=hanuja_prod'])).toEqual({ kind: 'confirm', databaseName: 'hanuja_prod' })
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
