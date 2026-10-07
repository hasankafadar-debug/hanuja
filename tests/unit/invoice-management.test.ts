import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  assertInvoiceRevision, assertSellerInvoiceWindow, getInvoiceRevision,
  isInvoiceManagementEnabled, requireInvoiceManagement, validateInvoiceReason,
} from '../../api/lib/invoice-management'

afterEach(() => vi.unstubAllEnvs())

describe('invoice mutation preconditions', () => {
  const invoice = { id: 'invoice-1', fileKey: 'private/v1/aa/file-1.bin' }
  it('allows the instant before 30 days and refuses the exact boundary', () => {
    const first = new Date('2026-01-31T12:00:00Z')
    expect(() => assertSellerInvoiceWindow(first, new Date('2026-03-02T11:59:59.999Z'))).not.toThrow()
    expect(() => assertSellerInvoiceWindow(first, new Date('2026-03-02T12:00:00Z'))).toThrow()
    expect(() => assertSellerInvoiceWindow(null)).not.toThrow()
  })
  it('requires a matching current file and refuses stale, weak and wildcard conditions', () => {
    const revision = getInvoiceRevision(invoice)
    expect(() => assertInvoiceRevision(invoice, `"${revision}"`)).not.toThrow()
    expect(() => assertInvoiceRevision(invoice, null)).toThrow(expect.objectContaining({ statusCode: 428 }))
    for (const value of ['*', `W/"${revision}"`, getInvoiceRevision({ ...invoice, fileKey: 'new-file' })]) {
      expect(() => assertInvoiceRevision(invoice, value)).toThrow(expect.objectContaining({ statusCode: 412 }))
    }
    expect(() => assertInvoiceRevision(null, revision)).toThrow(expect.objectContaining({ statusCode: 412 }))
    expect(() => assertInvoiceRevision(null, null)).not.toThrow()
  })
  it('rejects empty or excessive reasons and normalizes a valid explanation', () => {
    for (const value of [null, '  hata  ', 'x'.repeat(1001)]) expect(() => validateInvoiceReason(value)).toThrow()
    expect(validateInvoiceReason('  Yanlış dosya yüklendi.  ')).toBe('Yanlış dosya yüklendi.')
  })
  it('keeps the new management actions closed until explicitly enabled', () => {
    vi.stubEnv('INVOICE_MANAGEMENT_ENABLED', '')
    expect(isInvoiceManagementEnabled()).toBe(false)
    expect(() => requireInvoiceManagement()).toThrow(expect.objectContaining({ statusCode: 503 }))
    vi.stubEnv('INVOICE_MANAGEMENT_ENABLED', ' true ')
    expect(() => requireInvoiceManagement()).not.toThrow()
  })
})
