import type { OrderStatus } from '@prisma/client'

export const SELLER_ORDER_TABS = [
  'acik',
  'islemde',
  'kargolananlar',
  'teslim-edilenler',
  'faturasi-olmayanlar',
  'iptal-edilenler',
  'iade-edilenler',
  'tum',
] as const

export type SellerOrderTab = (typeof SELLER_ORDER_TABS)[number]

const SELLER_ORDER_TAB_STATUS_MAP: Record<SellerOrderTab, OrderStatus[]> = {
  acik: ['seller_queue_ready', 'seller_reviewing'],
  islemde: ['seller_accepted', 'preparing', 'awaiting_shipment'],
  kargolananlar: ['shipped'],
  'teslim-edilenler': ['delivered', 'delivery_confirmation_pending', 'delivery_confirmed'],
  'faturasi-olmayanlar': [
    'seller_queue_ready',
    'seller_reviewing',
    'seller_accepted',
    'preparing',
    'awaiting_shipment',
    'shipped',
    'delivered',
    'delivery_confirmation_pending',
    'delivery_confirmed',
  ],
  'iptal-edilenler': [
    'seller_rejected',
    'cancelled_by_customer',
    'cancelled_by_admin',
    'cancelled_due_to_payment_failure',
    'cancelled_due_to_seller_rejection',
    'cancelled_due_to_20day_breach',
  ],
  'iade-edilenler': [
    'return_requested',
    'return_under_review',
    'return_approved',
    'return_rejected',
    'return_in_transit',
    'return_received',
    'refund_pending',
    'refund_completed',
    'dispute_open',
    'dispute_resolved',
  ],
  tum: [
    'seller_queue_ready',
    'seller_reviewing',
    'seller_accepted',
    'preparing',
    'awaiting_shipment',
    'shipped',
    'delivered',
    'delivery_confirmation_pending',
    'delivery_confirmed',
    'seller_rejected',
    'cancelled_by_customer',
    'cancelled_by_admin',
    'cancelled_due_to_payment_failure',
    'cancelled_due_to_seller_rejection',
    'cancelled_due_to_20day_breach',
    'return_requested',
    'return_under_review',
    'return_approved',
    'return_rejected',
    'return_in_transit',
    'return_received',
    'refund_pending',
    'refund_completed',
    'dispute_open',
    'dispute_resolved',
  ],
}

export function isSellerOrderTab(value: string): value is SellerOrderTab {
  return SELLER_ORDER_TABS.includes(value as SellerOrderTab)
}

export function getSellerOrderStatusesForTab(tab: SellerOrderTab): OrderStatus[] {
  return SELLER_ORDER_TAB_STATUS_MAP[tab]
}

export function getSellerOrderTabLabel(tab: SellerOrderTab): string {
  switch (tab) {
    case 'acik':
      return 'Acik'
    case 'islemde':
      return 'Islemde'
    case 'kargolananlar':
      return 'Kargolananlar'
    case 'teslim-edilenler':
      return 'Teslim Edilenler'
    case 'faturasi-olmayanlar':
      return 'Faturası Olmayanlar'
    case 'iptal-edilenler':
      return 'Iptal Edilenler'
    case 'iade-edilenler':
      return 'Iade Edilenler'
    case 'tum':
      return 'Tumu'
  }
}
