import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
import { AdminOrderNotes } from '../../apps/admin-panel/src/app/(panel)/siparisler/[id]/_components/admin-order-notes'
import { SellerDeliveryReports } from '../../apps/admin-panel/src/app/(panel)/siparisler/[id]/_components/seller-delivery-reports'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
const require = createRequire(new URL('../../apps/admin-panel/package.json', import.meta.url))
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
beforeAll(() => vi.stubGlobal('React', React))
afterAll(() => vi.unstubAllGlobals())

describe('admin order notes and delivery reports', () => {
  it('renders author, Istanbul timestamp and escaped multiline text without edit/delete actions', () => {
    const html = renderToStaticMarkup(
      React.createElement(AdminOrderNotes, {
        orderId: 'order-1',
        notes: [
          {
            id: 'note-1',
            authorName: 'Admin Ayşe',
            body: '<script>alert(1)</script>\nMüşteri arandı.',
            createdAt: '2026-10-07T09:12:34.000Z',
          },
        ],
      }),
    )
    expect(html).toContain('Admin Ayşe')
    expect(html).toContain('12:12:34')
    expect(html).toContain('2026-10-07T09:12:34.000Z')
    expect(html).toContain('whitespace-pre-wrap')
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<script>')
    expect(html).toContain('Not Ekle')
    expect(html).not.toContain('Düzenle')
    expect(html).not.toContain('Sil</button>')
  })
  it('shows the empty admin notes state', () => {
    expect(
      renderToStaticMarkup(React.createElement(AdminOrderNotes, { orderId: 'order-1', notes: [] })),
    ).toContain('Henüz admin notu yok.')
  })
  it('keeps seller reports distinct from definitive teyit and matches each seller cargo', () => {
    const html = renderToStaticMarkup(
      React.createElement(SellerDeliveryReports, {
        lines: [
          {
            id: 'l1',
            sellerId: 's1',
            productName: 'Ürün 1',
            quantity: 2,
            cancelledQuantity: 1,
            seller: { displayName: 'Satıcı 1' },
            sellerDeliveryReportedAt: new Date('2026-10-07T09:00:00Z'),
            deliveryConfirmedAt: new Date('2026-10-07T10:00:00Z'),
          },
          {
            id: 'l2',
            sellerId: 's2',
            productName: 'Ürün 2',
            quantity: 1,
            cancelledQuantity: 0,
            seller: { displayName: 'Satıcı 2' },
            sellerDeliveryReportedAt: new Date('2026-10-07T09:01:00Z'),
            deliveryConfirmedAt: null,
          },
        ],
        shipments: [
          { sellerId: 's2', cargoProvider: 'Aras', trackingNumber: 'TRACK-2' },
          { sellerId: 's1', cargoProvider: 'PTT', trackingNumber: 'TRACK-1' },
        ],
      }),
    )
    expect(html).toContain('Ürün 1 × 1')
    expect(html).toContain('Kargo: PTT')
    expect(html).toContain('TRACK-1')
    expect(html).toContain('Kargo: Aras')
    expect(html).toContain('Teslim teyidi:')
    expect(html).toContain('Admin teslim teyidi bekleniyor')
  })
})
