import { createHmac } from 'node:crypto'
import { requireRuntimeSecret } from '@hanuja/config/env'

export function sellerBankOtpIdentifier(sellerId: string, userId: string): string {
  return `seller-bank-detail:${sellerId}:${userId}`
}

/** A database read must not disclose a short, payout-sensitive OTP. */
export function sellerBankOtpValue(identifier: string, code: string): string {
  const secret = requireRuntimeSecret('BETTER_AUTH_SECRET', process.env.BETTER_AUTH_SECRET)
  return `bank-otp:v1:${createHmac('sha256', secret).update(`${identifier}:${code}`).digest('hex')}`
}
