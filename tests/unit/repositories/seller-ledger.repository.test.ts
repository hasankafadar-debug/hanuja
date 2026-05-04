import { describe, expect, it, vi } from 'vitest'
import { Decimal } from '../../__mocks__/prisma-runtime'
import {
  coerceDecimal,
  createSellerLedgerRepository,
} from '../../../api/repositories/seller-ledger.repository'

describe('seller-ledger.repository', () => {
  it('coerces null, numbers, and Decimal instances safely', () => {
    expect(coerceDecimal(null).toNumber()).toBe(0)
    expect(coerceDecimal(125.5).toNumber()).toBe(125.5)
    expect(coerceDecimal(new Decimal('42.25')).toNumber()).toBe(42.25)
  })

  it('returns absolute penalty totals even when aggregate returns a raw number', async () => {
    const aggregate = vi.fn().mockResolvedValue({ _sum: { amount: -125.5 } })
    const repo = createSellerLedgerRepository({
      sellerLedgerEntry: {
        aggregate,
      },
    } as never)

    const total = await repo.getPenaltyDeducted('seller-1')

    expect(aggregate).toHaveBeenCalled()
    expect(total.toNumber()).toBe(125.5)
  })

  it('returns zero penalty when there are no matching ledger rows', async () => {
    const repo = createSellerLedgerRepository({
      sellerLedgerEntry: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { amount: null } }),
      },
    } as never)

    const total = await repo.getPenaltyDeducted('seller-1')

    expect(total.toNumber()).toBe(0)
  })
})
