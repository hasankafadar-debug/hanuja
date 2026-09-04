import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/lib/csrf-fetch', () => ({ csrfFetch: vi.fn() }))
vi.mock('@/lib/api-error', async () => import('../../apps/admin-panel/src/lib/api-error'))
vi.mock('@/lib/admin-refund-presentation', async () => import('../../apps/admin-panel/src/lib/admin-refund-presentation'))
import { ManualRefundCompletion } from '../../apps/admin-panel/src/app/(panel)/siparisler/[id]/_components/manual-refund-completion'

const appRequire = createRequire(new URL('../../apps/admin-panel/package.json', import.meta.url))
const React = appRequire('react')
const { renderToStaticMarkup } = appRequire('react-dom/server')
beforeAll(() => vi.stubGlobal('React', React))
afterAll(() => vi.unstubAllGlobals())

function render(blockedReason: string | null = null, outstandingAmount: string | null = '38560.50') {
  return renderToStaticMarkup(React.createElement(ManualRefundCompletion, {
    refundId: 'refund-1', orderId: 'order-1', orderLabel: '#26050074',
    customerName: 'Test Müşteri', currency: 'TRY', outstandingAmount, blockedReason,
  }))
}

describe('manual refund action initial rendering', () => {
  it('shows the exact remaining amount and explicit EFT action', () => {
    const html = render()
    expect(html).toContain('38.560,50 TL')
    expect(html).toContain('İade ödeme yapıldı')
    expect(html).toContain('Bankadan iadeyi yaptıktan sonra')
    expect(html).toContain('aria-haspopup="dialog"')
    expect(html).not.toContain('77.121')
  })
  it.each(['Kart iadesi sağlayıcı mutabakatı gerektiriyor.', 'Ödeme kaydı bulunamadı.', 'İade kalemleri doğrulanmalıdır.'])('does not offer payment completion for blocked refund: %s', (reason) => {
    const html = render(reason, null)
    expect(html).toContain(reason)
    expect(html).not.toContain('<button')
    expect(html).not.toContain('0,00 TL')
  })
})
