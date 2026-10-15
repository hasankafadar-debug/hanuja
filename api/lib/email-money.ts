/** Format persisted monetary amounts for mail without rounding away kuruş. */
export function formatEmailMoney(value: number | string | { toString(): string }): string {
  const amount = Number(typeof value === 'object' ? value.toString() : value)
  if (!Number.isFinite(amount)) throw new Error('EMAIL_AMOUNT_INVALID')
  return `${amount.toLocaleString('tr-TR', {
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  })} TL`
}
