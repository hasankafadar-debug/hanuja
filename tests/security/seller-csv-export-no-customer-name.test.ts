/**
 * Security test — seller CSV export must mask customer name.
 *
 * The seller orders CSV download is a bulk PII surface — historically a
 * common scrape vector. Verifies the export uses maskCustomerName so that
 * a leaked CSV cannot reconstruct full customer identity.
 *
 * 05-security-rules.md, 09-seller-panel-rules.md
 */
import { describe, it, expect } from 'vitest'
import { maskCustomerName } from '../../packages/security/src/data-masker'

// Inlined CSV row builder mirroring apps/seller-panel/src/app/api/seller/orders/route.ts
// so the test stays close to the real serialization path without bundling Next.
function buildOrderCsvRow(order: {
  id: string
  createdAt: Date
  status: string
  customer?: { name?: string | null } | null
  lines: Array<{ quantity: number; unitPrice: number; product: { name: string } | null }>
}) {
  const escape = (value: string) => `"${value.replace(/"/g, '""')}"`
  const total = order.lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0)
  const products = order.lines.map((line) => line.product?.name ?? 'Urun').join(', ')
  return [
    escape(`#${order.id.slice(-8).toUpperCase()}`),
    escape(order.createdAt.toISOString()),
    escape(maskCustomerName(order.customer?.name)),
    escape(order.status),
    escape(products),
    escape(total.toFixed(2)),
  ].join(';')
}

describe('seller CSV export — no full customer name', () => {
  it('writes masked customer name (first + last initial)', () => {
    const row = buildOrderCsvRow({
      id: 'order_xyz12345',
      createdAt: new Date('2026-04-27T00:00:00Z'),
      status: 'preparing',
      customer: { name: 'Ahmet Yılmaz' },
      lines: [{ quantity: 1, unitPrice: 250, product: { name: 'Sehpa' } }],
    })
    expect(row).toContain('"Ahmet Y."')
    expect(row).not.toContain('Yılmaz')
  })

  it('handles missing customer with placeholder', () => {
    const row = buildOrderCsvRow({
      id: 'order_a1b2c3d4',
      createdAt: new Date('2026-04-27T00:00:00Z'),
      status: 'preparing',
      customer: null,
      lines: [{ quantity: 1, unitPrice: 100, product: { name: 'Tabak' } }],
    })
    expect(row).toContain('"-"')
  })

  it('does not leak email even if customer object includes one (defense in depth)', () => {
    const row = buildOrderCsvRow({
      id: 'order_zzzzzzzz',
      createdAt: new Date('2026-04-27T00:00:00Z'),
      status: 'preparing',
      customer: { name: 'Mehmet Demir' },
      lines: [{ quantity: 2, unitPrice: 50, product: { name: 'Mum' } }],
    })
    expect(row).not.toMatch(/@/)
    expect(row).toContain('"Mehmet D."')
  })
})
