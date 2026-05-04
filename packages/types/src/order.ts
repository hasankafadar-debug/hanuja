export type OrderStatus =
  | 'draft'
  | 'checkout_started'
  | 'payment_pending'
  | 'bank_transfer_waiting'
  | 'bank_transfer_confirmed'
  | 'payment_confirmed'
  | 'payment_failed'
  | 'payment_cancelled'
  | 'seller_queue_ready'
  | 'seller_reviewing'
  | 'seller_accepted'
  | 'seller_rejected'
  | 'preparing'
  | 'awaiting_shipment'
  | 'shipped'
  | 'delivered'
  | 'delivery_confirmation_pending'
  | 'delivery_confirmed'
  | 'cancelled_by_customer'
  | 'cancelled_by_admin'
  | 'cancelled_due_to_payment_failure'
  | 'cancelled_due_to_seller_rejection'
  | 'cancelled_due_to_20day_breach'
  | 'return_requested'
  | 'return_under_review'
  | 'return_approved'
  | 'return_rejected'
  | 'return_in_transit'
  | 'return_received'
  | 'refund_pending'
  | 'refund_completed'
  | 'dispute_open'
  | 'dispute_resolved'

export type SellerOrderTab =
  | 'acik'
  | 'islemde'
  | 'kargolananlar'
  | 'teslim-edilenler'
  | 'iptal-edilenler'
  | 'iade-edilenler'
  | 'tum'

export type Order = {
  id: string
  customerId: string
  status: OrderStatus
  totalAmount: number
  createdAt: Date
  updatedAt: Date
}
