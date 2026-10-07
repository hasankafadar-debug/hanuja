import { createRequire } from 'node:module'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import BillingInformationCard from '../../apps/seller-panel/src/app/(panel)/siparisler/[id]/_components/billing-information-card'
import { createOrderRepository } from '../../api/repositories/order.repository'

const require = createRequire(new URL('../../apps/seller-panel/package.json', import.meta.url))
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
beforeAll(() => vi.stubGlobal('React', React))
afterAll(() => vi.unstubAllGlobals())

const address = { fullName: 'Ayşe Yılmaz', addressLine1: 'Fatura Caddesi 1', city: 'İstanbul', district: 'Kadıköy', postalCode: '34700' }
function render(extra = {}) {
  return renderToStaticMarkup(React.createElement(BillingInformationCard, {
    address, aliasEmail: 'pftest@fatura.hanuja.com.tr', aliasStatus: 'ready', ...extra,
  }))
}

describe('seller billing information', () => {
  it('renders individual invoice identity and alias without any account email', () => {
    const html = render({ address: { ...address, invoiceType: 'individual', tcNumber: '12345678901' } })
    expect(html).toContain('Fatura Bilgileri')
    expect(html).toContain('Ayşe Yılmaz')
    expect(html).toContain('12345678901')
    expect(html).toContain('Fatura Caddesi 1')
    expect(html).toContain('pftest@fatura.hanuja.com.tr')
    expect(html).toContain('PDF faturayı')
  })
  it('renders corporate tax information and omits personal identity', () => {
    const html = render({ address: { ...address, invoiceType: 'corporate', companyName: 'Örnek Ltd.', taxOffice: 'Kadıköy', taxNumber: '1234567890', tcNumber: 'PRIVATE_ID' } })
    expect(html).toContain('Örnek Ltd.')
    expect(html).toContain('1234567890')
    expect(html).toContain('Vergi dairesi')
    expect(html).not.toContain('PRIVATE_ID')
  })
  it('distinguishes disabled receiving, temporary alias errors and missing billing data', () => {
    expect(render({ aliasEmail: null, aliasStatus: 'disabled' })).toContain('Otomatik fatura alımı şu anda kapalı')
    expect(render({ aliasEmail: null, aliasStatus: 'error' })).toContain('Sayfayı yenileyerek tekrar deneyin')
    expect(render()).toContain('Kayıtlı değil')
    expect(render({ address: null })).toContain('Fatura adresi mevcut değil')
    const foreign = render({ address: { ...address, isForeignNational: true, tcNumber: 'PRIVATE_ID' } })
    expect(foreign).toContain('Yabancı uyruklu')
    expect(foreign).not.toContain('PRIVATE_ID')
  })
  it('selects only the billing fields required for invoice issuance, never the account relation/email', async () => {
    const findUnique = vi.fn().mockResolvedValue(null)
    await createOrderRepository({ order: { findUnique } } as never).findByIdForSeller('order-1', 'seller-1')
    const args = findUnique.mock.calls[0]![0]
    expect(args.include.billingAddress.select).toMatchObject({ fullName: true, invoiceType: true, tcNumber: true, taxNumber: true, companyName: true })
    expect(args.include.address.select.tcNumber).toBe(true)
    expect(args.include.billingAddress.select).not.toHaveProperty('user')
    expect(args.include.customer.select).not.toHaveProperty('email')
  })
})
