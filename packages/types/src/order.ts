/**
 * Order status reflects the full lifecycle.
 * payment, fulfillment, delivery, and return are separate concerns.
 * See .claude/rules/08-order-lifecycle-rules.md
 */
export type OrderStatus =
  | 'draft'
  | 'payment_pending'
  | 'payment_confirmed'
  | 'seller_queue_ready'
  | 'preparing'
  | 'shipped'
  | 'delivered'
  | 'delivery_confirmed'
  | 'cancelled_by_customer'
  | 'cancelled_by_seller'
  | 'cancelled_by_admin'
  | 'return_requested'
  | 'return_approved'
  | 'refund_completed'

export type Order = {
  id: string
  customerId: string
  status: OrderStatus
  totalAmount: number
  createdAt: Date
  updatedAt: Date
}
