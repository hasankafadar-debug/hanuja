import type { AdminRefundQueueRow } from '@hanuja/api/services/admin-refund-query.service'

export const refundSourceLabels: Record<AdminRefundQueueRow['sourceType'], string> = {
  cancellation: 'İptal',
  return_request: 'Ürün iadesi',
  dispute: 'Uyuşmazlık',
}

// The query returns exact two-decimal strings. Group digits without floating-point rounding.
export function formatRefundOutstandingAmount(amount: string | null, currency: string) {
  if (amount === null) return 'Tutar doğrulanmalı'
  const [whole, fraction] = amount.split('.')
  return `${whole!.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${fraction} ${currency === 'TRY' ? 'TL' : currency}`
}

export function refundPaymentLabel(payment: AdminRefundQueueRow['payment']) {
  return payment?.method === 'eft'
    ? 'Havale / EFT'
    : payment?.method === 'card'
      ? 'Kredi kartı'
      : 'Ödeme kaydı doğrulanmalı'
}

export const CARD_REFUND_RETRY_WARNING =
  'Otomatik yeniden denemeler devam ediyor olabilir. Yeni bir ödeme yapmadan önce siparişteki iade kayıtlarını ve sağlayıcı sonucunu kontrol edin.'
