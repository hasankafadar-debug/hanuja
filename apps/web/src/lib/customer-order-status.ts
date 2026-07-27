const CUSTOMER_ORDER_STATUS_LABELS: Record<string, string> = {
  seller_queue_ready: 'Tasarımcıya İletildi',
  seller_reviewing: 'Tasarımcı İnceliyor',
  seller_accepted: 'Tasarımcı Kabul Etti',
  seller_rejected: 'Tasarımcı Reddetti',
  cancelled_due_to_seller_rejection: 'Tasarımcı Reddi İptal',
  canceled_due_to_seller_rejection: 'Tasarımcı Reddi İptal',
  waiting_for_seller: 'Tasarımcı Yanıtı Bekleniyor',
  delivery_confirmed: 'Tamamlanan Sipariş',
}

/** Customer-facing order labels that differ from shared operational terminology. */
export function getCustomerOrderStatusLabel(status: string): string | undefined {
  return CUSTOMER_ORDER_STATUS_LABELS[status]
}
