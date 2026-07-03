import { Decimal } from '@prisma/client/runtime/client'

function toDecimal(value: number | Decimal | string) {
  return value instanceof Decimal ? value : new Decimal(value)
}

export function roundMoney(value: number | Decimal | string): Decimal {
  const decimal = toDecimal(value)
  const sign = decimal.isNegative() ? -1 : 1
  const abs = decimal.abs()
  const milli = abs.mul(1000).floor()
  const thirdDigit = milli.modulo(10).toNumber()
  const truncated = milli.minus(thirdDigit).dividedBy(1000)

  const roundedAbs = thirdDigit <= 5
    ? truncated.toDecimalPlaces(2, Decimal.ROUND_DOWN)
    : truncated.plus(0.01).toDecimalPlaces(2, Decimal.ROUND_DOWN)

  return sign < 0 ? roundedAbs.negated() : roundedAbs
}

// `formatMoney` lives in ./format-money so client components (which cannot
// import Prisma's Decimal runtime — it pulls node:async_hooks) can use the
// formatter without dragging the rest of this module into the client bundle.
// Re-export it here for server-side callers that already import from './money'.
export { formatMoney } from './format-money'
