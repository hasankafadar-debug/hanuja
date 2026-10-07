import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  InvoiceFileCard,
  type InvoiceFileCardProps,
} from '../../packages/ui/src/components/composite/invoice-file-card'

const defaults: InvoiceFileCardProps = {
  endpoint: '/api/seller/orders/order-1/invoice',
  invoice: {
    fileName: 'fatura.pdf',
    uploadedAt: '2026-10-01T10:00:00Z',
    revision: 'a'.repeat(64),
  },
  request: vi.fn(),
  onChanged: vi.fn(),
  canEdit: true,
}

function render(overrides: Partial<InvoiceFileCardProps> = {}) {
  return renderToStaticMarkup(
    createElement(InvoiceFileCard, { ...defaults, ...overrides }),
  )
}

afterEach(() => vi.useRealTimers())

describe('invoice file card capabilities', () => {
  it('offers replacement with a reason and conditional deletion for an editable invoice', () => {
    const html = render()
    expect(html).toContain('Faturayı Güncelle')
    expect(html).toContain('Değiştirme gerekçesi')
    expect(html).toContain('Faturayı Sil')
    expect(html).toContain('Görüntüle')
    expect(html).toContain('invoice?download=1')
  })

  it('leaves seller upload available while new management capabilities are gated off', () => {
    const html = render({ allowDelete: false })
    expect(html).toContain('Faturayı Güncelle')
    expect(html).not.toContain('Faturayı Sil')
  })

  it('keeps admin viewing available while upload and deletion are gated off', () => {
    const html = render({ allowDelete: false, allowUpload: false })
    expect(html).toContain('Görüntüle')
    expect(html).toContain('İndir')
    expect(html).not.toContain('type="file"')
    expect(html).not.toContain('Faturayı Sil')
  })

  it('offers the first upload without a replacement reason when there is no invoice', () => {
    const html = render({ invoice: null })
    expect(html).toContain('Fatura Yükle')
    expect(html).not.toContain('Değiştirme gerekçesi')
    expect(html).not.toContain('Faturayı Sil')
  })

  it('disables seller mutations at the exact deadline while keeping viewing and download', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-31T10:00:00Z'))
    const html = render({
      firstUploadedAt: '2026-10-01T10:00:00Z',
      sellerEditDeadline: '2026-10-31T10:00:00Z',
    })
    expect(html).toContain('30 günlük düzeltme süresi doldu.')
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*?Faturayı Sil/)
    expect(html).toMatch(/<input[^>]*type="file"[^>]*disabled=""/)
    expect(html).toContain('href="/api/seller/orders/order-1/invoice"')
    expect(html).toContain(
      'href="/api/seller/orders/order-1/invoice?download=1"',
    )
  })
})
