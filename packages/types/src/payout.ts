export type PayoutStatus =
  | 'hold_active'
  | 'payout_blocked'
  | 'payout_ready'
  | 'payout_scheduled'
  | 'payout_paid'

export type SellerLedgerEntryType =
  | 'sale'
  | 'commission'
  | 'cargo_charge'
  | 'ad_fee'
  | 'penalty'
  | 'refund'
  | 'coupon_share'
  | 'eft_discount'
  | 'manual_adjustment'
  | 'payout'
  | 'chargeback'
  | 'dispute_hold'
  | 'dispute_release'

export type Payout = {
  id: string
  sellerId: string
  orderId: string
  netAmount: number
  status: PayoutStatus
  holdUntil: Date | null
  paidAt: Date | null
  createdAt: Date
}

export type SellerLedgerEntry = {
  id: string
  sellerId: string
  type: SellerLedgerEntryType
  amount: number
  eventKey: string | null
  referenceType: string
  referenceId: string
  balanceAfter: number
  effectiveAt: Date
  createdAt: Date
}

export type SellerStatementRow = {
  id: string
  date: Date
  reference: string
  orderId?: string
  refundSourceType?: 'cancellation' | 'return_request' | 'dispute'
  topic: string
  description: string
  credit: number
  debit: number
  balance: number
}
