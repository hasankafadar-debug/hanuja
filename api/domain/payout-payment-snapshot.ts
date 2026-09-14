import { createHash } from 'node:crypto'
import type { Payout, SellerBankDetail } from '@prisma/client'

export function payoutPaymentSnapshot(payout: Payout, bank: SellerBankDetail | null) {
  return createHash('sha256').update(JSON.stringify({
    id: payout.id,
    amount: payout.netAmount.toFixed(2),
    currency: payout.currency,
    status: payout.status,
    updatedAt: payout.updatedAt.toISOString(),
    bank: bank ? {
      id: bank.id, iban: bank.iban, accountHolder: bank.accountHolder,
      bankName: bank.bankName, updatedAt: bank.updatedAt.toISOString(),
    } : null,
  })).digest('hex')
}
