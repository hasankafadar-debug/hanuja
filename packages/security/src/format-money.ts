/**
 * Client-safe money formatter.
 *
 * Uses plain JS number arithmetic (no Prisma Decimal). This file must remain
 * dependency-free so it can be imported from React Server Components, Client
 * Components, and edge runtime. Server code that needs the exact Decimal-based
 * `roundMoney` should import from './money' instead.
 *
 * Default output: `1.250 TL` (no decimals, "TL" suffix, tr-TR thousands separator).
 * For accounting/legal surfaces that must keep kuruş precision (invoice PDFs,
 * seller statement exports, payment provider payloads), use the dedicated
 * formatters in those modules — do NOT pass `withKurus` here as a workaround.
 */
export function formatMoney(
  value: number | string,
  opts?: { withKurus?: boolean; suffix?: string | null },
): string {
  const raw = typeof value === 'string' ? Number.parseFloat(value) : value
  const num = Number.isFinite(raw) ? raw : 0

  // Mirror the 3rd-decimal truncate/round-up rule of `roundMoney` so display
  // matches persisted totals. 1.235 → 1.23, 1.236 → 1.24.
  const sign = num < 0 ? -1 : 1
  const abs = Math.abs(num)
  const milli = Math.floor(abs * 1000)
  const thirdDigit = milli % 10
  const truncated = (milli - thirdDigit) / 1000
  const roundedAbs = thirdDigit <= 5 ? truncated : truncated + 0.01
  const amount = sign * roundedAbs

  const withKurus = opts?.withKurus ?? false
  const suffix = opts?.suffix === undefined ? 'TL' : opts.suffix

  const formatted = amount.toLocaleString('tr-TR', {
    minimumFractionDigits: withKurus ? 2 : 0,
    maximumFractionDigits: withKurus ? 2 : 0,
  })

  return suffix ? `${formatted} ${suffix}` : formatted
}
