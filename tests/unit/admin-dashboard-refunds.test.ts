import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import type { AdminRefundQueueRow } from '../../api/services/admin-refund-query.service'
import { RefundQueuePreview } from '../../apps/admin-panel/src/app/(panel)/dashboard/refund-queue-preview'
import { StatCard } from '../../packages/ui/src/components/composite/stat-card'

// Use the application's installed React/renderer, without adding a second React version to tests.
const appRequire = createRequire(new URL('../../apps/admin-panel/package.json', import.meta.url))
const React = appRequire('react')
const { renderToStaticMarkup } = appRequire('react-dom/server')

beforeAll(() => {
  // Vitest's JSX transform is classic; Next's production transform uses the automatic runtime.
  vi.stubGlobal('React', React)
})
afterAll(() => vi.unstubAllGlobals())

function refund(overrides: Partial<AdminRefundQueueRow> = {}): AdminRefundQueueRow {
  return {
    id: 'refund-first',
    orderId: 'order-74',
    sourceType: 'cancellation',
    sourceId: 'cancellation-1',
    status: 'manual_required',
    customerAmount: '77121.00',
    outstandingAmount: '38560.50',
    failureReason: null,
    createdAt: new Date('2026-09-03T14:00:30Z'),
    order: {
      publicNumber: 26050074,
      currency: 'TRY',
      customer: { id: 'customer-1', name: 'Test Müşteri' },
    },
    payment: { method: 'eft', provider: 'manual_eft' },
    items: [],
    ...overrides,
  }
}

function render(
  rows: AdminRefundQueueRow[],
  kind: 'manual' | 'failed_card' = 'manual',
  total = rows.length,
): string {
  return renderToStaticMarkup(
    React.createElement(RefundQueuePreview, { kind, queue: { rows, total } }),
  )
}

describe('dashboard refund previews', () => {
  it.each([0, 1, 8])(
    'renders refund counters with the shared green style only above zero (%i)',
    (count) => {
      const html = renderToStaticMarkup(
        React.createElement(StatCard, {
          title: 'Manuel İade Bekleyen',
          value: String(count),
          tone: count > 0 ? 'attention' : 'default',
        }),
      )
      expect(html).toContain(`data-tone="${count > 0 ? 'attention' : 'default'}"`)
      if (count > 0) {
        expect(html).toContain('bg-[#f0fdf4]')
        expect(html).toContain('border-[#86efac]')
        expect(html).toContain('İşlem bekliyor')
      } else {
        expect(html).not.toContain('bg-[#f0fdf4]')
        expect(html).not.toContain('İşlem bekliyor')
      }
    },
  )

  it('renders separate refunds for the same order with order links and exact remaining amounts', () => {
    const html = render([refund(), refund({ id: 'refund-second' })])

    expect(html).toContain('2 iade işlemi')
    expect(html).toContain('dashboard-refund-refund-first')
    expect(html).toContain('dashboard-refund-refund-second')
    expect(html.match(/href="\/siparisler\/order-74"/g)).toHaveLength(2)
    expect(html.match(/38\.560,50 TL/g)).toHaveLength(2)
    expect(html).not.toContain('77.121,00 TL')
    expect(html).toContain('Test Müşteri')
    expect(html).toContain('#26050074')
    expect(html).toContain('Havale / EFT')
    expect(html).toContain('İptal')
    expect(html).toContain('17:00')
    expect(html).toMatch(/datetime="2026-09-03T14:00:30.000Z"/i)
    expect(html).toContain('Her satır ayrı bir iade işlemidir')
  })

  it('distinguishes an unknown amount from zero and never substitutes the original total', () => {
    const html = render([refund({ outstandingAmount: null, payment: null })])
    expect(html).toContain('Tutar doğrulanmalı')
    expect(html).toContain('Ödeme kaydı doğrulanmalı')
    expect(html).not.toContain('77.121')
    expect(html).not.toContain('0,00 TL')
    expect(render([refund({ outstandingAmount: '0.00' })])).toContain('0,00 TL')
  })

  it('preserves exact cents for large values and displays the order currency', () => {
    const html = render([refund({ outstandingAmount: '9999999999999999.99' })])
    expect(html).toContain('9.999.999.999.999.999,99 TL')
    const row = refund()
    expect(render([{ ...row, order: { ...row.order, currency: 'EUR' } }])).toContain(
      '38.560,50 EUR',
    )
  })

  it('warns about unresolved card errors without claiming automatic retries are exhausted', () => {
    const html = render(
      [refund({ status: 'failed', payment: { method: 'card', provider: 'iyzico' } })],
      'failed_card',
    )
    expect(html).toContain('card-refund-failure-warning')
    expect(html).toContain('Otomatik yeniden denemeler devam ediyor olabilir')
    expect(html).toContain('sağlayıcı sonucunu kontrol edin')
    expect(html).toContain('Kredi kartı')
    expect(html).toContain('Başarısız')
    expect(html).not.toContain('<button')
    expect(html).not.toContain('<form')
    expect(html).not.toContain('İade ödeme yapıldı')
  })

  it('shows partial card failure and only the unpaid balance', () => {
    const html = render(
      [
        refund({
          status: 'partially_completed',
          outstandingAmount: '12.05',
          sourceType: 'return_request',
          payment: { method: 'card', provider: 'iyzico' },
        }),
      ],
      'failed_card',
    )
    expect(html).toContain('Kısmen tamamlandı · Hata var')
    expect(html).toContain('Ürün iadesi')
    expect(html).toContain('12,05 TL')
    expect(html).not.toContain('77.121')
  })

  it('keeps manual card reconciliation distinguishable from EFT refunds', () => {
    const html = render([
      refund({ sourceType: 'dispute', payment: { method: 'card', provider: 'iyzico' } }),
    ])
    expect(html).toContain('Kredi kartı')
    expect(html).toContain('Manuel işlem gerekli')
    expect(html).toContain('Uyuşmazlık')
    expect(html).not.toContain('card-refund-failure-warning')
  })

  it('shows clear zero states and does not display a card failure warning without failures', () => {
    expect(render([])).toContain('Manuel ödeme iadesi bekleyen işlem yok.')
    const html = render([], 'failed_card')
    expect(html).toContain('0 iade işlemi')
    expect(html).toContain('Başarısız kart iadesi yok.')
    expect(html).not.toContain('card-refund-failure-warning')
  })

  it('shows the full queue total even when only the oldest five are previewed', () => {
    const rows = Array.from({ length: 5 }, (_, index) => refund({ id: `refund-${index}` }))
    const html = render(rows, 'manual', 23)
    expect(html).toContain('23 iade işlemi')
    expect(html).toContain('En eski 5 işlem gösteriliyor; toplam 23 işlem var.')
    expect(html.match(/data-testid="dashboard-refund-refund-/g)).toHaveLength(5)
    // The full /iadeler payment-refund queue belongs to a later stage, not a dead-end CTA here.
    expect(html).not.toContain('href="/iadeler')
  })

  it('escapes customer content and does not expose raw provider errors', () => {
    const row = refund()
    const html = render([
      {
        ...row,
        order: { ...row.order, customer: { id: 'customer-1', name: '<script>alert(1)</script>' } },
        failureReason: 'provider-private-debug-data',
      },
    ])
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('provider-private-debug-data')
  })

  it('wires authenticated server reads, matching counters and in-page queue navigation', async () => {
    const source = await readFile(
      new URL('../../apps/admin-panel/src/app/(panel)/dashboard/page.tsx', import.meta.url),
      'utf8',
    )
    expect(source.indexOf('await getAdminSession()')).toBeLessThan(
      source.indexOf('createPrismaForRoute()'),
    )
    expect(source).toContain('refundQuery.listManualRequiredForAdmin({ take: 5 })')
    expect(source).toContain('refundQuery.listFailedCardForAdmin({ take: 5 })')
    expect(source).toContain('value: String(manualRefunds.total)')
    expect(source).toContain('value: String(failedCardRefunds.total)')
    expect(source).toContain("href: '#manuel-iadeler'")
    expect(source).toContain("href: '#basarisiz-kart-iadeleri'")
    expect(source).not.toContain('.catch(')
    expect(source).not.toContain("'use client'")
    expect(render([refund()])).toContain('id="manuel-iadeler"')
    expect(render([], 'failed_card')).toContain('id="basarisiz-kart-iadeleri"')
  })
})
