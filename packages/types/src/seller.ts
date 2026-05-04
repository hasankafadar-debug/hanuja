export type SellerStatus = 'pending' | 'active' | 'suspended' | 'rejected'

export type Seller = {
  id: string
  userId: string
  slug: string
  displayName: string
  status: SellerStatus
  createdAt: Date
}

export type SellerDashboardMetrics = {
  pendingOrders: number
  averagePreparationDays: number
  cancellationRate: number
  supplierFailureRate: number
}
