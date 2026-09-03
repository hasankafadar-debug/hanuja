export interface OrderQuantitySummaryLine {
  quantity: number
  cancelledQuantity: number
  shippedQuantity: number
  activeQuantity?: number | null
}

export interface OrderQuantitySummary {
  originalQuantity: number
  currentQuantity: number
  cancelledQuantity: number
  shippedQuantity: number
}

/**
 * Summarizes the quantities shown on seller/admin order detail screens.
 * v2 orders carry the authoritative activeQuantity; older rows fall back to
 * original minus cancelled quantity.
 */
export function summarizeOrderQuantities(
  lines: readonly OrderQuantitySummaryLine[],
): OrderQuantitySummary {
  return lines.reduce<OrderQuantitySummary>(
    (summary, line) => {
      summary.originalQuantity += line.quantity
      summary.currentQuantity += Math.max(
        0,
        line.activeQuantity ?? line.quantity - line.cancelledQuantity,
      )
      summary.cancelledQuantity += line.cancelledQuantity
      summary.shippedQuantity += line.shippedQuantity
      return summary
    },
    {
      originalQuantity: 0,
      currentQuantity: 0,
      cancelledQuantity: 0,
      shippedQuantity: 0,
    },
  )
}
