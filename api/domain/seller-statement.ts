import type { LedgerEntryType } from '@prisma/client'

export interface SellerStatementRow {
  id: string
  date: Date
  reference: string
  topic: string
  description: string
  credit: number
  debit: number
  balance: number
}

export function getSellerStatementTopic(type: LedgerEntryType): string {
  switch (type) {
    case 'sale':
      return 'Satis'
    case 'commission':
      return 'Komisyon'
    case 'cargo_charge':
      return 'Kargo Kesintisi'
    case 'ad_fee':
      return 'Platform Kullanim'
    case 'penalty':
      return 'Ceza'
    case 'refund':
      return 'Iade'
    case 'coupon_share':
      return 'Kupon Payi'
    case 'eft_discount':
      return 'Havale Indirimi'
    case 'manual_adjustment':
      return 'Manuel Duzeltme'
    case 'payout':
      return 'Odeme'
    case 'chargeback':
      return 'Chargeback'
    case 'dispute_hold':
      return 'Uyusmazlik Blokesi'
    case 'dispute_release':
      return 'Uyusmazlik Cozumu'
  }
}

export function getSellerStatementDescription(type: LedgerEntryType): string {
  switch (type) {
    case 'sale':
      return 'Brut satis'
    case 'commission':
      return 'Platform komisyonu'
    case 'cargo_charge':
      return 'Kargo kesintisi'
    case 'ad_fee':
      return 'Platform kullanim bedeli'
    case 'penalty':
      return 'Ceza yansitmasi'
    case 'refund':
      return 'Iade kesintisi'
    case 'coupon_share':
      return 'Kupon maliyet paylasimi'
    case 'eft_discount':
      return 'Havale indirimi'
    case 'manual_adjustment':
      return 'Manuel duzeltme'
    case 'payout':
      return 'EFT'
    case 'chargeback':
      return 'Chargeback borcu'
    case 'dispute_hold':
      return 'Uyusmazlik nedeniyle gecici bloke'
    case 'dispute_release':
      return 'Uyusmazlik blokesi kaldirildi'
  }
}
