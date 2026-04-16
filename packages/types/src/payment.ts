export type PaymentMethod = 'card' | 'eft'

export type PaymentStatus =
  | 'pending'
  | 'confirmed'
  | 'failed'
  | 'refunded'
  | 'chargebacked'

export type Payment = {
  id: string
  orderId: string
  method: PaymentMethod
  status: PaymentStatus
  amount: number
  currency: 'TRY'
  confirmedAt: Date | null
  createdAt: Date
}
