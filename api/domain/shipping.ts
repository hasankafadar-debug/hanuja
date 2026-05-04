export const FREE_SHIPPING_THRESHOLD_TRY = 1500
export const FLAT_SHIPPING_FEE_TRY = 99

export function isFreeShippingEligible(subtotalTry: number): boolean {
  return subtotalTry >= FREE_SHIPPING_THRESHOLD_TRY
}

export function calculateShippingFee(subtotalTry: number): number {
  return isFreeShippingEligible(subtotalTry) ? 0 : FLAT_SHIPPING_FEE_TRY
}
