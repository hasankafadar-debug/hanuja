/**
 * Security tests — seller must not receive customer email
 *
 * Verifies that seller-facing repository methods do NOT request `email`
 * on the customer relation. The seller-panel UI also masks customer name.
 *
 * `address.phone` is intentionally NOT stripped or masked for seller-facing
 * reads: delivery/cargo coordination is the seller's operational
 * responsibility, so the customer's delivery phone is shown raw in seller
 * order payloads (business decision, 2026-07-03). This is different from
 * `customer.email` (never selected) and `customer.name` (masked via
 * `maskCustomerName`). See `.claude/rules/12-production-readiness.md` §8.
 *
 * Until full email aliasing infra (separate epic) lands, the no-email
 * select is the minimum boundary that prevents direct customer email
 * exposure.
 *
 * 05-security-rules.md, 09-seller-panel-rules.md
 */
import { describe, it, expect } from 'vitest'
import { createOrderRepository } from '../../api/repositories/order.repository'
import { maskCustomerName } from '../../packages/security/src/data-masker'

type Args = Record<string, unknown>

function makePrismaSpy() {
  const calls: { method: string; args: Args }[] = []
  const recorder = (method: string) => async (args: Args) => {
    calls.push({ method, args })
    return null
  }
  const prisma = {
    order: {
      findUnique: recorder('order.findUnique'),
      findFirst: recorder('order.findFirst'),
      findMany: recorder('order.findMany'),
      count: async () => 0,
      update: recorder('order.update'),
    },
    orderStatusHistory: { create: recorder('orderStatusHistory.create') },
  }
  return { prisma: prisma as unknown as Parameters<typeof createOrderRepository>[0], calls }
}

function customerSelect(args: Args): Record<string, unknown> | undefined {
  const include = (args as { include?: { customer?: { select?: Record<string, unknown> } } }).include
  return include?.customer?.select
}

function addressSelect(args: Args): Record<string, unknown> | undefined {
  const include = (args as { include?: { address?: { select?: Record<string, unknown> } } }).include
  const address = include?.address
  if (!address || typeof address !== 'object' || !('select' in address)) return undefined
  return address.select as Record<string, unknown>
}

describe('seller-facing repository methods — no customer.email leakage', () => {
  it('findByIdForSeller does not select customer.email', async () => {
    const { prisma, calls } = makePrismaSpy()
    const repo = createOrderRepository(prisma)
    await repo.findByIdForSeller('order_1', 'seller_1')
    const select = customerSelect(calls[0]!.args)
    expect(select).toBeDefined()
    expect(select).not.toHaveProperty('email')
    expect(select?.email).toBeUndefined()
  })

  it('listForSellerQueue does not select customer.email', async () => {
    const { prisma, calls } = makePrismaSpy()
    const repo = createOrderRepository(prisma)
    await repo.listForSellerQueue({ sellerId: 'seller_1' })
    const select = customerSelect(calls[0]!.args)
    expect(select).toBeDefined()
    expect(select).not.toHaveProperty('email')
    expect(select?.email).toBeUndefined()
  })

  it('listForAdmin still selects customer.email (admin context allowed)', async () => {
    const { prisma, calls } = makePrismaSpy()
    const repo = createOrderRepository(prisma)
    await repo.listForAdmin({})
    const select = customerSelect(calls[0]!.args)
    expect(select).toBeDefined()
    expect(select?.email).toBe(true)
  })
})

describe('seller-facing repository methods — address.phone is permitted raw (delivery coordination)', () => {
  it('findByIdForSeller selects address.phone (seller needs it for delivery/cargo coordination)', async () => {
    const { prisma, calls } = makePrismaSpy()
    const repo = createOrderRepository(prisma)
    await repo.findByIdForSeller('order_1', 'seller_1')
    const select = addressSelect(calls[0]!.args)
    expect(select).toBeDefined()
    expect(select?.phone).toBe(true)
  })

  it('listForSellerQueue selects address.phone (seller needs it for delivery/cargo coordination)', async () => {
    const { prisma, calls } = makePrismaSpy()
    const repo = createOrderRepository(prisma)
    await repo.listForSellerQueue({ sellerId: 'seller_1' })
    const select = addressSelect(calls[0]!.args)
    expect(select).toBeDefined()
    expect(select?.phone).toBe(true)
  })
})

describe('maskCustomerName — seller-safe display', () => {
  it('keeps first name and abbreviates last name', () => {
    expect(maskCustomerName('Ahmet Yılmaz')).toBe('Ahmet Y.')
  })

  it('uses last token initial for multi-part names', () => {
    expect(maskCustomerName('Ali Veli Doğan')).toBe('Ali D.')
  })

  it('returns single-token names as-is (no last name to abbreviate)', () => {
    expect(maskCustomerName('Ahmet')).toBe('Ahmet')
  })

  it('handles empty/null/whitespace gracefully', () => {
    expect(maskCustomerName(null)).toBe('-')
    expect(maskCustomerName(undefined)).toBe('-')
    expect(maskCustomerName('')).toBe('-')
    expect(maskCustomerName('   ')).toBe('-')
  })

  it('does not return raw full name for two-part inputs', () => {
    const masked = maskCustomerName('Mehmet Demir')
    expect(masked).not.toContain('Demir')
    expect(masked).toBe('Mehmet D.')
  })
})
