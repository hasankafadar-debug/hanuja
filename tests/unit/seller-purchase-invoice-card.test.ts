import { createRequire } from 'node:module'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Decimal } from '../__mocks__/prisma-runtime'
import PurchaseInvoiceCard, {
  type PurchaseInvoiceStatus,
} from '../../apps/seller-panel/src/app/(panel)/siparisler/[id]/_components/purchase-invoice-card'
import { calculateSellerPurchaseInvoice } from '../../api/domain/seller-purchase-invoice'

const require = createRequire(new URL('../../apps/seller-panel/package.json', import.meta.url))
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
beforeAll(() => vi.stubGlobal('React', React))
afterAll(() => vi.unstubAllGlobals())

const invoice = calculateSellerPurchaseInvoice([
  {
    id: 'line-1', productName: 'Gea Berjer', quantity: 1, cancelledQuantity: 0,
    totalPrice: new Decimal(1000), couponDiscountAmount: new Decimal(0), commissionRate: new Decimal(0.2),
    commissionAmount: new Decimal(240), commissionExemptedAt: null, taxRate: new Decimal(0.2),
  },
  {
    id: 'line-2', productName: 'Muaf Vazo', quantity: 1, cancelledQuantity: 0,
    totalPrice: new Decimal(100), couponDiscountAmount: new Decimal(0), commissionRate: new Decimal(0.2),
    commissionAmount: new Decimal(24), commissionExemptedAt: new Date('2026-10-01T00:00:00Z'), taxRate: new Decimal(0.1),
  },
] as never)

const pending: PurchaseInvoiceStatus = {
  reviewStatus: null, reviewNote: null, invoiceNumber: null, invoiceDate: null, expectedPayoutDate: null, shipped: true,
}

function render(status: Partial<PurchaseInvoiceStatus> = {}) {
  return renderToStaticMarkup(React.createElement(PurchaseInvoiceCard, {
    orderNumber: '#26050116', invoice, status: { ...pending, ...status },
  }))
}

// Satıcı Hanuja modeli: the seller sees exactly what to invoice Hanuja, with the order number.
describe('seller purchase invoice card', () => {
  it('shows the order number instruction and amounts without the KDV breakdown', () => {
    const html = render()
    expect(html).toContain('açıklama alanına sipariş numarasını yazın')
    expect(html).toContain('#26050116')
    expect(html).toContain('−240,00 TL')
    expect(html).toContain('760,00 TL')
    expect(html).not.toContain('>KDV</th>')
    expect(html).not.toContain('Matrah')
    expect(html).toContain('860,00 TL')
  })

  it('shows an exempt commission as zero without a minus sign or rate', () => {
    const html = render()
    expect(html).not.toContain('−0,00 TL')
    expect((html.match(/%20 \+ KDV/g) ?? []).length).toBe(1)
  })

  it('warns after shipment until the invoice arrives, without blocking anything else', () => {
    expect(render()).toContain('Fatura gelmeden hakediş süresi başlamaz')
    expect(render({ shipped: false })).toContain('Faturayı ürünü kargoya verirken kesin ve yükleyin')
  })

  it('tells the seller the review state, the rejection reason and the expected payout day', () => {
    expect(render({ reviewStatus: 'pending' })).toContain('Hanuja kontrol ediyor')
    expect(render({ reviewStatus: 'rejected', reviewNote: 'Sipariş numarası eksik' })).toContain('Gerekçe: Sipariş numarası eksik')
    const approved = render({
      reviewStatus: 'approved', invoiceNumber: 'TMG2026000000042',
      invoiceDate: '2026-10-09T21:00:00.000Z', expectedPayoutDate: '2026-11-12T21:00:00.000Z',
    })
    expect(approved).toContain('Fatura No: TMG2026000000042')
    expect(approved).toContain('10 Ekim 2026')
    expect(approved).toContain('13 Kasım 2026')
  })
})
