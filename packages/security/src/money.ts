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

export function formatMoney(
  value: number | Decimal | string,
  opts?: { currency?: 'TRY'; minimumFractionDigits?: number; maximumFractionDigits?: number },
) {
  const rounded = roundMoney(value)
  const amount = rounded.toNumber()
  const minimumFractionDigits = opts?.minimumFractionDigits ?? 2
  const maximumFractionDigits = opts?.maximumFractionDigits ?? 2

  if (opts?.currency === 'TRY') {
    return amount.toLocaleString('tr-TR', {
      style: 'currency',
      currency: 'TRY',
      minimumFractionDigits,
      maximumFractionDigits,
    })
  }

  return amount.toLocaleString('tr-TR', {
    minimumFractionDigits,
    maximumFractionDigits,
  })
}
