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

  it('casts the advisory lock result so Prisma does not deserialize PostgreSQL void', async () => {
    const queryRaw = vi.fn().mockResolvedValue([{ pg_advisory_xact_lock: '' }])
    const create = vi.fn().mockResolvedValue({ id: 'ledger-1' })
    const transactionClient = {
      $queryRaw: queryRaw,
      sellerLedgerEntry: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { amount: null } }),
        create,
      },
    }
    const repo = createSellerLedgerRepository({} as never)

    await repo.createEntry(
      {
        sellerId: 'seller-1',
        type: 'sale',
        amount: new Decimal('100.00'),
        referenceType: 'order',
        referenceId: 'order-1',
      },
      transactionClient as never,
    )

    expect(queryRaw).toHaveBeenCalledTimes(1)
    const query = queryRaw.mock.calls[0]?.[0] as { strings?: string[] }
    expect(query.strings?.join('')).toContain('pg_advisory_xact_lock')
    expect(query.strings?.join('')).toContain('::text')
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ balanceAfter: new Decimal('100.00') }),
    }))
  })
})
