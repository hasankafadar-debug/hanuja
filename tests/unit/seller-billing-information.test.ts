import { createRequire } from 'node:module'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import BillingInformationCard from '../../apps/seller-panel/src/app/(panel)/siparisler/[id]/_components/billing-information-card'
import { createOrderRepository } from '../../api/repositories/order.repository'
import { PLATFORM_LEGAL_INFO } from '../../api/lib/platform-info'

const require = createRequire(new URL('../../apps/seller-panel/package.json', import.meta.url))
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
beforeAll(() => vi.stubGlobal('React', React))
afterAll(() => vi.unstubAllGlobals())

function render(extra = {}) {
  return renderToStaticMarkup(
    React.createElement(BillingInformationCard, {
      recipientName: 'Ayşe Yılmaz',
      aliasEmail: 'pftest@fatura.hanuja.com.tr',
      aliasStatus: 'ready',
      ...extra,
    }),
  )
}

// Satıcı Hanuja modeli: the seller invoices Hanuja, never the customer.
describe('seller billing information', () => {
  it("shows Hanuja's legal invoice identity without an invoice alias", () => {
    const html = render()
    expect(html).toContain('Fatura Bilgileri')
    expect(html).toContain(PLATFORM_LEGAL_INFO.companyLegalName)
    expect(html).toContain(PLATFORM_LEGAL_INFO.taxNumber)
    expect(html).toContain(PLATFORM_LEGAL_INFO.taxOffice)
    expect(html).toContain(PLATFORM_LEGAL_INFO.mersis)
    expect(html).not.toContain('pftest@fatura.hanuja.com.tr')
    expect(html).not.toContain('PDF faturayı')
  })

  it('gives the waybill note for delivery to the customer on behalf of Hanuja', () => {
    const html = render()
    expect(html).toContain(
      `${PLATFORM_LEGAL_INFO.companyLegalName} adına müşteriye teslim edilmek üzere`,
    )
    expect(html).toContain('Teslim alacak kişi: Ayşe Yılmaz')
    expect(render({ recipientName: null })).not.toContain('Teslim alacak kişi')
  })

  it('has no receiving setup or temporary alias errors', () => {
    expect(render({ aliasEmail: null, aliasStatus: 'disabled' })).not.toContain(
      'Otomatik fatura alımı şu anda kapalı',
    )
    expect(render({ aliasEmail: null, aliasStatus: 'error' })).not.toContain(
      'Sayfayı yenileyerek tekrar deneyin',
    )
  })

  it("never selects the customer's invoice identity (TC/VKN) or account email for sellers", async () => {
    const findUnique = vi.fn().mockResolvedValue(null)
    await createOrderRepository({
      order: { findUnique },
    } as never).findByIdForSeller('order-1', 'seller-1')
    const args = findUnique.mock.calls[0]![0]
    expect(args.include).not.toHaveProperty('billingAddress')
    expect(args.include.address.select).toMatchObject({
      fullName: true,
      phone: true,
      addressLine1: true,
    })
    for (const field of ['tcNumber', 'taxNumber', 'taxOffice', 'companyName', 'invoiceType']) {
      expect(args.include.address.select).not.toHaveProperty(field)
    }
    expect(args.include.customer.select).not.toHaveProperty('email')
  })
})
