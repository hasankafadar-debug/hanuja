import { describe, expect, it } from 'vitest'
import {
  canSeeMessage,
  messageAudience,
  isPendingReturnInspection,
} from '../../api/domain/communication-audience'
import { isWithinWithdrawalWindow } from '../../api/domain/withdrawal-window'
import { participantReturn } from '../../api/lib/participant-return'
import {
  buildPublicLegalDocumentContext,
  renderLegalDocuments,
} from '../../api/lib/legal-documents'

describe('Hanuja seller model', () => {
  it('keeps each receipt independent while the legal clock starts at the last active receipt', () => {
    const first = {
      quantity: 1,
      cancelledQuantity: 0,
      deliveredAt: new Date('2026-09-01T10:00:00+03:00'),
    }
    const second = {
      quantity: 1,
      cancelledQuantity: 0,
      deliveredAt: null as Date | null,
    }
    expect(isWithinWithdrawalWindow({ lines: [first, second] }, new Date('2026-10-01'))).toBe(true)
    second.deliveredAt = new Date('2026-10-01T10:00:00+03:00')
    expect(
      isWithinWithdrawalWindow({ lines: [first, second] }, new Date('2026-10-15T23:59:00+03:00')),
    ).toBe(true)
    expect(
      isWithinWithdrawalWindow({ lines: [first, second] }, new Date('2026-10-16T00:00:00+03:00')),
    ).toBe(false)
  })

  it('ignores cancelled goods when finding the last receipt', () => {
    expect(
      isWithinWithdrawalWindow(
        {
          lines: [
            {
              quantity: 1,
              cancelledQuantity: 0,
              deliveredAt: new Date('2026-09-01'),
            },
            { quantity: 1, cancelledQuantity: 1, deliveredAt: null },
          ],
        },
        new Date('2026-10-01'),
      ),
    ).toBe(false)
  })

  it('restricts admin replies to their target and retains old shared messages for staff', () => {
    expect(messageAudience('seller', 'customer')).toBe('seller')
    expect(messageAudience('customer', 'seller')).toBe('customer')
    expect(canSeeMessage('customer', { authorRole: 'seller', audience: 'customer' })).toBe(false)
    expect(canSeeMessage('customer', { authorRole: 'admin', audience: 'seller' })).toBe(false)
    expect(canSeeMessage('customer', { authorRole: 'admin' })).toBe(false)
    expect(canSeeMessage('customer', { authorRole: 'admin', audience: 'customer' })).toBe(true)
  })

  it('never leaks seller rejection details, images or internal conversation in a customer return', () => {
    const request = {
      status: 'rejected',
      reviewedAt: new Date('2026-09-01'),
      sellerRejectedAt: new Date('2026-09-05'),
      sellerRejectReason: 'Secret inspection',
      sellerRejectDescription: 'Internal detail',
      escalatedDispute: { description: 'Secret dispute' },
      items: [{ rejectionReason: 'Used', rejectedQuantity: 1 }],
      evidence: [
        { id: 'seller-photo', uploadedBy: 'seller' },
        { id: 'customer-photo', uploadedBy: 'buyer' },
      ],
      messages: [
        { authorRole: 'seller', audience: 'seller', body: 'Secret' },
        { authorRole: 'admin', audience: 'customer', body: 'Hanuja reply' },
      ],
    }
    const result = participantReturn(request, 'customer', 'buyer')
    expect(result.status).toBe('under_review')
    expect(JSON.stringify(result)).not.toMatch(/Secret|Internal detail|seller-photo|Used/)
    expect(result.messages).toHaveLength(1)
    expect(result.evidence).toEqual([{ id: 'customer-photo', uploadedBy: 'buyer' }])
  })

  it('keeps a later designer rejection pending after preliminary cargo approval', () => {
    const request = {
      disputeId: 'dispute',
      reviewedAt: new Date('2026-09-01'),
      sellerRejectedAt: new Date('2026-09-05'),
    }
    expect(isPendingReturnInspection(request)).toBe(true)
    expect(
      isPendingReturnInspection({
        ...request,
        reviewedAt: new Date('2026-09-06'),
      }),
    ).toBe(false)
    expect(isPendingReturnInspection({ ...request, disputeId: null })).toBe(false)
  })

  it('shows the final admin decision instead of the preliminary designer rejection', () => {
    const request = {
      status: 'refund_completed',
      reviewedAt: new Date('2026-10-14'),
      sellerRejectedAt: new Date('2026-10-13'),
      escalatedDispute: { status: 'resolved_for_customer' },
      messages: [],
      evidence: [],
      items: [
        {
          requestedQuantity: 2,
          acceptedQuantity: 1,
          rejectedQuantity: 1,
          rejectionReason: 'Internal',
        },
      ],
    }
    expect(participantReturn(request, 'customer').items[0]).toMatchObject({
      acceptedQuantity: 2,
      rejectedQuantity: 0,
      rejectionReason: null,
    })
    expect(
      participantReturn(
        {
          ...request,
          status: 'rejected',
          escalatedDispute: { status: 'resolved_for_seller' },
        },
        'customer',
      ).status,
    ).toBe('rejected')
  })

  it('renders the Hanuja company as seller and accepts only consistent installment totals', () => {
    const context = {
      ...buildPublicLegalDocumentContext(),
      subtotalAmount: 1000,
      shippingAmount: 50,
      installmentCount: 3,
      installmentDifferenceAmount: 100,
      totalAmount: 1150,
    }
    const bundle = renderLegalDocuments(context)
    expect(bundle.distanceSalesHtml).toContain('Taksit Farkı')
    expect(bundle.distanceSalesHtml).toContain('100,00 TL')
    expect(bundle.distanceSalesHtml).toContain('Tasarımcı / Marka')
    expect(bundle.distanceSalesHtml).not.toContain('aracı hizmet sağlayıcı')
    expect(bundle.sellerSnapshot[0]?.companyName).toContain('Suat Salih Ayakkabı')
    expect(() => renderLegalDocuments({ ...context, totalAmount: 1050 })).toThrow('nihai toplam')
  })
})
