/** Actual receipt is separate from payout/operational delivery approval. */
export function isWithinWithdrawalWindow(order: {
  deliveredAt?: Date | null
  lines: Array<{ quantity: number; cancelledQuantity: number; deliveredAt?: Date | null }>
}, now = new Date()): boolean {
  const active = order.lines.filter((line) => line.quantity > line.cancelledQuantity)
  if (!active.length) return false
  // A buyer can withdraw before all goods arrive; the legal countdown has not started.
  if (active.some((line) => !line.deliveredAt)) return true
  const lastReceipt = new Date(Math.max(...active.map((line) => line.deliveredAt!.getTime())))
  // Turkish calendar day boundary, inclusive of the fourteenth day.
  const localDay = (date: Date) => Math.floor((date.getTime() + 3 * 60 * 60 * 1000) / 86_400_000)
  return localDay(now) <= localDay(lastReceipt) + 14
}
