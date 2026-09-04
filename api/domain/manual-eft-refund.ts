import { Decimal } from '@prisma/client/runtime/client'

interface ManualEftRefund {
  orderId: string
  status: string
  customerAmount: Decimal
  payment: {
    orderId: string
    method: string
    provider: string
    status: string
    amount: Decimal
    refundedAmount: Decimal
  } | null
  items: Array<{ status: string; amount: Decimal }>
}

// Shared by the server-rendered confirmation and the write service. Never trust a
// client-supplied amount: it is only a stale-screen check, not a financial input.
export function getManualEftRefundCompletion(refund: ManualEftRefund) {
  const unfinished = refund.items.filter((item) => item.status !== 'completed')
  const remaining = unfinished.reduce((sum, item) => sum.add(item.amount), new Decimal(0))
  const outstandingAmount = refund.items.length ? remaining.toFixed(2) : null
  const blocked = (blockedReason: string) => ({ outstandingAmount, blockedReason })

  if (refund.status !== 'manual_required') return blocked('Bu iade manuel ödeme onayı beklemiyor.')
  if (!refund.payment) return blocked('Ödeme kaydı bulunamadı. Önce ödeme kaydı doğrulanmalıdır.')
  if (refund.payment.method !== 'eft' || refund.payment.provider !== 'manual_eft') {
    return blocked(
      'Bu buton yalnızca EFT/havale iadeleri içindir. Kart iadesini sağlayıcı ile mutabakat yaparak değerlendirin.',
    )
  }
  if (refund.payment.orderId !== refund.orderId || refund.payment.status !== 'confirmed') {
    return blocked('Siparişin onaylanmış EFT/havale ödemesi doğrulanamadı.')
  }
  if (
    !refund.items.length ||
    refund.items.some((item) => !item.amount.gt(0)) ||
    !refund.items
      .reduce((sum, item) => sum.add(item.amount), new Decimal(0))
      .eq(refund.customerAmount)
  ) {
    return blocked('İade kalemleri ve toplam tutar doğrulanmalıdır. Ödeme onayı verilemez.')
  }
  if (unfinished.some((item) => !['pending', 'manual_required'].includes(item.status))) {
    return blocked(
      'İade kalemlerinin işlem durumu değişmiş. Sayfayı yenileyip kayıtları kontrol edin.',
    )
  }
  if (!remaining.gt(0) || refund.payment.refundedAmount.add(remaining).gt(refund.payment.amount)) {
    return blocked('İade tutarı ödemenin kalan tutarıyla uyuşmuyor. Önce mutabakat yapılmalıdır.')
  }
  return { outstandingAmount, blockedReason: null }
}
