import type { LedgerEntryType, RefundSourceType } from '@prisma/client'

export interface SellerStatementRow {
  id: string
  date: Date
  reference: string
  orderId?: string
  refundSourceType?: RefundSourceType
  topic: string
  description: string
  credit: number
  debit: number
  balance: number
}

export function getSellerStatementTopic(
  type: LedgerEntryType,
  refundSourceType?: RefundSourceType,
): string {
  switch (type) {
    case 'sale':
      return 'Satış'
    case 'commission':
      return 'Komisyon'
    case 'cargo_charge':
      return 'Kargo Kesintisi'
    case 'ad_fee':
      return 'Platform Kullanımı'
    case 'penalty':
      return 'Ceza'
    case 'refund':
      if (refundSourceType === 'cancellation') return 'Ürün İptali'
      if (refundSourceType === 'return_request' || refundSourceType === 'dispute') {
        return 'Ürün İadesi'
      }
      return 'İade'
    case 'coupon_share':
      return 'Kupon Payı'
    case 'eft_discount':
      return 'Havale İndirimi'
    case 'manual_adjustment':
      return 'Manuel Düzeltme'
    case 'payout':
      return 'Ödeme'
    case 'chargeback':
      return 'Chargeback'
    case 'dispute_hold':
      return 'Uyuşmazlık Blokesi'
    case 'dispute_release':
      return 'Uyuşmazlık Çözümü'
    case 'commission_invoice_issued':
      return 'Komisyon Faturası'
    case 'penalty_invoice_issued':
      return 'Ceza Faturası'
  }
}

export function getSellerStatementDescription(type: LedgerEntryType): string {
  switch (type) {
    case 'sale':
      return 'Brüt satış'
    case 'commission':
      return 'Platform komisyonu'
    case 'cargo_charge':
      return 'Kargo kesintisi'
    case 'ad_fee':
      return 'Platform kullanım bedeli'
    case 'penalty':
      return 'Ceza yansıtması'
    case 'refund':
      return 'İade kesintisi'
    case 'coupon_share':
      return 'Kupon maliyet paylaşımı'
    case 'eft_discount':
      return 'Havale indirimi'
    case 'manual_adjustment':
      return 'Manuel düzeltme'
    case 'payout':
      return 'EFT'
    case 'chargeback':
      return 'Chargeback borcu'
    case 'dispute_hold':
      return 'Uyuşmazlık nedeniyle geçici bloke'
    case 'dispute_release':
      return 'Uyuşmazlık blokesi kaldırıldı'
    case 'commission_invoice_issued':
      return 'Komisyon faturası kesildi'
    case 'penalty_invoice_issued':
      return 'Ceza faturası kesildi'
  }
}
