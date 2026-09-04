import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import type { AdminRefundQueueRow } from '../../api/services/admin-refund-query.service'
import { RefundPaymentQueue } from '../../apps/admin-panel/src/app/(panel)/iadeler/_components/refund-payment-queue'
import { RefundQueueTabs } from '../../apps/admin-panel/src/app/(panel)/iadeler/_components/refund-queue-tabs'
import {
  parseRefundQueueParams,
  readRefundTab,
  refundQueueHref,
  type RefundQueueParams,
} from '../../apps/admin-panel/src/lib/admin-refund-list-params'

const appRequire = createRequire(new URL('../../apps/admin-panel/package.json', import.meta.url))
const React = appRequire('react')
const { renderToStaticMarkup } = appRequire('react-dom/server')
beforeAll(() => vi.stubGlobal('React', React))
afterAll(() => vi.unstubAllGlobals())

const base = parseRefundQueueParams(undefined, 'manual_refunds')
function row(overrides: Partial<AdminRefundQueueRow> = {}): AdminRefundQueueRow {
  return {
    id: 'refund-1',
    orderId: 'order-74',
    sourceType: 'cancellation',
    sourceId: 'cancel-1',
    status: 'manual_required',
    customerAmount: '77121.00',
    outstandingAmount: '38560.50',
    failureReason: null,
    createdAt: new Date('2026-09-03T14:00:00Z'),
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
  rows: AdminRefundQueueRow[] = [],
  params: RefundQueueParams = base,
  total = rows.length,
): string {
  return renderToStaticMarkup(
    React.createElement(RefundPaymentQueue, { params, result: { rows, total } }),
  )
}

describe('refund queue URL parameters', () => {
  it.each([undefined, {}, { tab: 'invalid' }, { tab: 'requests' }])(
    'preserves the existing return-request view by default: %j',
    (raw) => {
      expect(readRefundTab(raw)).toBe('requests')
    },
  )
  it('reads the first tab value and recognizes both payment queues', () => {
    expect(readRefundTab({ tab: ['manual_refunds', 'requests'] })).toBe('manual_refunds')
    expect(readRefundTab({ tab: 'failed_card_refunds' })).toBe('failed_card_refunds')
  })
  it.each(['-5', '0', '1.5', 'NaN', 'Infinity', '99999999999999999999', ''])(
    'normalizes invalid page values without fractional Prisma offsets: %s',
    (page) => {
      expect(parseRefundQueueParams({ page }, 'manual_refunds').page).toBe(1)
    },
  )
  it('bounds page numbers, query length and allowed page sizes', () => {
    expect(base).toMatchObject({ page: 1, pageSize: 20, q: '', method: 'all', source: 'all' })
    expect(
      parseRefundQueueParams(
        { page: '10000', pageSize: '100', q: 'x'.repeat(200) },
        'manual_refunds',
      ),
    ).toMatchObject({ page: 9999, pageSize: 100, q: 'x'.repeat(100) })
    expect(
      parseRefundQueueParams({ pageSize: '500', method: 'other', source: 'bad' }, 'manual_refunds'),
    ).toMatchObject({ pageSize: 20, method: 'all', source: 'all' })
  })
  it('supports payment/source filters but does not permit EFT filtering in the card queue', () => {
    expect(
      parseRefundQueueParams(
        { method: 'eft', source: 'cancellation', q: '  #26050074  ' },
        'manual_refunds',
      ),
    ).toMatchObject({ method: 'eft', source: 'cancellation', q: '#26050074' })
    expect(
      parseRefundQueueParams({ method: 'missing', source: 'dispute' }, 'manual_refunds'),
    ).toMatchObject({ method: 'missing', source: 'dispute' })
    expect(
      parseRefundQueueParams({ method: 'eft', source: 'return_request' }, 'failed_card_refunds'),
    ).toMatchObject({ method: 'all', source: 'return_request' })
  })
  it('preserves filter values across page links and encodes query text safely', () => {
    const params = {
      ...base,
      q: 'A & B #26050074',
      method: 'eft' as const,
      source: 'cancellation' as const,
      pageSize: 50,
    }
    const url = new URL(refundQueueHref(params, 2), 'https://admin.test')
    expect(url.pathname).toBe('/iadeler')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      tab: 'manual_refunds',
      q: params.q,
      method: 'eft',
      source: 'cancellation',
      pageSize: '50',
      page: '2',
    })
    expect(new URL(refundQueueHref(params, 1), url).searchParams.has('page')).toBe(false)
  })
})

describe('full refund payment queue rendering', () => {
  it('keeps same-order refunds separate, linking each to its order and preserving cents', () => {
    const html = render([row(), row({ id: 'refund-2' })])
    expect(html.match(/data-testid="refund-queue-row-/g)).toHaveLength(2)
    expect(html.match(/href="\/siparisler\/order-74"/g)).toHaveLength(4)
    expect(html.match(/38\.560,50 TL/g)).toHaveLength(2)
    expect(html).not.toContain('77.121,00 TL')
    expect(html).toContain('Test Müşteri')
    expect(html).toContain('2 iade işlemi')
    expect(html).toContain('17:00')
    expect(html).toContain('Kalan tutarlar gösterilir; bu liste ödeme yapmaz.')
    // Keep absolutely positioned screen-reader labels inside the table's scroll boundary.
    expect(html).toContain('class="relative overflow-x-auto')
  })
  it('shows remaining partial refunds, manual cards and missing payment/amount records clearly', () => {
    const manual = render([
      row({ payment: null, outstandingAmount: null }),
      row({
        id: 'manual-card',
        payment: { method: 'card', provider: 'iyzico' },
        sourceType: 'dispute',
      }),
    ])
    expect(manual).toContain('Tutar doğrulanmalı')
    expect(manual).toContain('Ödeme kaydı doğrulanmalı')
    expect(manual).toContain('Kredi kartı')
    expect(manual).toContain('Uyuşmazlık')
    const card = render(
      [
        row({
          payment: { method: 'card', provider: 'iyzico' },
          status: 'partially_completed',
          outstandingAmount: '12.05',
        }),
      ],
      { ...base, tab: 'failed_card_refunds' },
    )
    expect(card).toContain('Kısmen tamamlandı · Hata var')
    expect(card).toContain('12,05 TL')
    expect(card).toContain('Otomatik yeniden denemeler devam ediyor olabilir')
    expect(card).not.toContain('name="method"')
  })
  it('has a GET-only filter form that resets pagination while retaining the selected queue', () => {
    const html = render(
      [],
      { ...base, page: 2, q: 'Müşteri', method: 'eft', source: 'cancellation', pageSize: 50 },
      60,
    )
    expect(html).toContain('action="/iadeler" method="GET"')
    expect(html).toContain('name="tab" value="manual_refunds"')
    expect(html).not.toContain('name="page"')
    expect(html).not.toContain('method="POST"')
    expect(html).not.toContain('/api/admin/refunds')
    expect(html).not.toContain('İade ödeme yapıldı')
    expect(html).toContain('Filtreleri temizle')
  })
  it('distinguishes empty queues from empty search results', () => {
    expect(render()).toContain('Manuel ödeme iadesi bekleyen işlem yok.')
    expect(render([], { ...base, q: 'Eşleşmeyen müşteri' })).toContain(
      'Filtrelere uygun iade işlemi bulunamadı.',
    )
    expect(render([], { ...base, tab: 'failed_card_refunds' })).toContain(
      'Başarısız kart iadesi yok.',
    )
    expect(render([], { ...base, tab: 'failed_card_refunds' })).not.toContain(
      'Otomatik yeniden denemeler',
    )
  })
  it('renders full totals and next-page links beyond the dashboard preview limit', () => {
    const html = render(
      Array.from({ length: 20 }, (_, i) => row({ id: `refund-${i}` })),
      base,
      42,
    )
    expect(html).toContain('1–20 / 42 işlem · Sayfa 1 / 3')
    expect(html).toContain('href="/iadeler?tab=manual_refunds&amp;page=2"')
    expect(html).toContain('rel="next"')
    expect(html).not.toContain('rel="prev"')
    const last = render([row(), row({ id: 'refund-last' })], { ...base, page: 3 }, 42)
    expect(last).toContain('41–42 / 42 işlem · Sayfa 3 / 3')
    expect(last).toContain('rel="prev"')
    expect(last).not.toContain('rel="next"')
  })
  it('escapes customer data and never exposes raw provider diagnostics', () => {
    const item = row()
    item.order.customer.name = '<script>unsafe</script>'
    item.failureReason = 'private-provider-payload'
    const html = render([item], { ...base, q: '<script>q</script>' })
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('private-provider-payload')
  })
  it('keeps three distinct accessible navigation links and resets filters on tab change', () => {
    const html = renderToStaticMarkup(
      React.createElement(RefundQueueTabs, {
        tab: 'manual_refunds',
        counts: { pendingManualRefunds: 5, failedCardRefunds: 0 },
      }),
    )
    expect(html).toContain('aria-label="İade listeleri"')
    expect(html).toContain('href="/iadeler"')
    expect(html).toContain('href="/iadeler?tab=manual_refunds"')
    expect(html).toContain('href="/iadeler?tab=failed_card_refunds"')
    expect(html.match(/aria-current="page"/g)).toHaveLength(1)
    expect(html).toContain('bg-[#dcfce7] text-green-800')
    expect(html).not.toContain('&amp;page=')
  })
  it('preserves the existing return-policy copy and legacy action while keeping authentication first', async () => {
    const source = await readFile(
      new URL('../../apps/admin-panel/src/app/(panel)/iadeler/page.tsx', import.meta.url),
      'utf8',
    )
    expect(source.indexOf('await getAdminSession()')).toBeLessThan(
      source.indexOf('createPrismaForRoute()'),
    )
    expect(source).toContain('14 gün sonrası')
    expect(source).toContain('iadeler admin değerlendirmesi gerektirir.')
    expect(source).toContain('refundAmount" value="0"')
    expect(source).toContain("if (tab !== 'requests')")
    expect(source).toContain('redirect(refundQueueHref(params, totalPages))')
    expect(source).not.toContain('.catch(')
  })
})
