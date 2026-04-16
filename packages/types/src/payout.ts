/**
 * Payout status reflects the seller payout lifecycle.
 * Countdown starts from delivery_confirmed — never from delivered or shipped.
 * 30-day hold applies after delivery_confirmed.
 * See .claude/rules/07-marketplace-finance-rules.md
 */
export type PayoutStatus =
  | 'hold_active'
  | 'payout_blocked'
  | 'payout_ready'
  | 'payout_scheduled'
  | 'payout_paid'

export type Payout = {
  id: string
  sellerId: string
  orderId: string
  netAmount: number
  status: PayoutStatus
  holdUntil: Date
  paidAt: Date | null
  createdAt: Date
}

export type SellerLedgerEntryType =
  | 'sale'
  | 'commission'
  | 'cargo_charge'
  | 'ad_fee'
  | 'penalty'
  | 'refund'
  | 'coupon_share'
  | 'manual_adjustment'
  | 'payout'

export type SellerLedgerEntry = {
  id: string
  sellerId: string
  type: SellerLedgerEntryType
  amount: number
  referenceType: string
  referenceId: string
  balanceAfter: number
  createdAt: Date
}
