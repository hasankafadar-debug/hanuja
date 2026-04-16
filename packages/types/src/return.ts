export type ReturnRequestStatus =
  | 'requested'
  | 'under_review'
  | 'approved'
  | 'rejected'
  | 'in_transit'
  | 'received'
  | 'refund_completed'

export type ReturnRequest = {
  id: string
  orderId: string
  customerId: string
  reason: string
  status: ReturnRequestStatus
  createdAt: Date
}
