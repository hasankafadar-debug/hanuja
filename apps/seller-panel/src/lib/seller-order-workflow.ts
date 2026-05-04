export type SellerWorkflowAction = 'accept' | 'preparing' | 'awaiting' | 'tracking'

export function getSellerWorkflowStep(status: string) {
  if (['shipped', 'delivered', 'delivery_confirmation_pending', 'delivery_confirmed'].includes(status)) {
    return 4
  }
  if (status === 'awaiting_shipment') return 3
  if (status === 'preparing') return 2
  if (status === 'seller_accepted') return 1
  return 0
}

export function getAvailableSellerWorkflowActions(status: string): SellerWorkflowAction[] {
  switch (status) {
    case 'seller_queue_ready':
    case 'seller_reviewing':
      return ['accept']
    case 'seller_accepted':
      return ['preparing']
    case 'preparing':
      return ['awaiting']
    case 'awaiting_shipment':
      return ['tracking']
    default:
      return []
  }
}
