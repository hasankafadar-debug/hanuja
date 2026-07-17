import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  notifyFollowersMock,
  notifyDiscountAudienceMock,
  discountRuleFindManyMock,
  discountRuleUpdateManyMock,
  queueAddMock,
} = vi.hoisted(() => ({
  notifyFollowersMock: vi.fn(),
  notifyDiscountAudienceMock: vi.fn(),
  discountRuleFindManyMock: vi.fn(),
  discountRuleUpdateManyMock: vi.fn(),
  queueAddMock: vi.fn(),
}))

vi.mock('bullmq', () => ({
  Worker: vi.fn(),
}))

vi.mock('../../../api/lib/redis', () => ({
  redis: {},
}))

vi.mock('../../../api/lib/queue', () => ({
  QUEUE_NAMES: { CAMPAIGN_DISCOUNT: 'campaign-discount' },
  campaignDiscountQueue: { add: queueAddMock },
}))

vi.mock('../../../api/lib/prisma', () => ({
  prisma: {
    discountRule: {
      findMany: discountRuleFindManyMock,
      updateMany: discountRuleUpdateManyMock,
    },
  },
}))

vi.mock('../../../api/services/store-follow.service', () => ({
  createStoreFollowService: () => ({
    notifyFollowersAboutDiscount: notifyFollowersMock,
  }),
}))

vi.mock('../../../api/services/campaign-discount.service', () => ({
  createCampaignDiscountService: () => ({
    notifyDiscountAudience: notifyDiscountAudienceMock,
  }),
  buildDiscountFingerprint: (rule: { id: string; startsAt: Date | null; createdAt: Date }) =>
    `${rule.id}:${(rule.startsAt ?? rule.createdAt).toISOString()}`,
}))

import { processCampaignDiscountJob } from '../../../api/jobs/campaign-discount.job'

function fanOutJob(data: Record<string, unknown>) {
  return { id: 'job-1', name: 'fan-out', data } as never
}

function activationScanJob() {
  return { id: 'job-2', name: 'activation-scan', data: {} } as never
}

describe('campaign-discount.job — fan-out', () => {
  beforeEach(() => {
    notifyFollowersMock.mockReset()
    notifyDiscountAudienceMock.mockReset()
    discountRuleFindManyMock.mockReset()
    discountRuleUpdateManyMock.mockReset()
    queueAddMock.mockReset()
  })

  it('notifies both the store-follower audience and the favorite/cart audience', async () => {
    notifyFollowersMock.mockResolvedValue(undefined)
    notifyDiscountAudienceMock.mockResolvedValue({ notified: 2 })

    await processCampaignDiscountJob(
      fanOutJob({
        discountRuleId: 'rule-1',
        discountFingerprint: 'rule-1:2026-07-17T00:00:00.000Z',
        sellerId: 'seller-1',
        sellerName: 'Atelier Noa',
        sellerSlug: 'atelier-noa',
      }),
    )

    expect(notifyFollowersMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sellerId: 'seller-1',
        sellerName: 'Atelier Noa',
        sellerSlug: 'atelier-noa',
        discountRuleId: 'rule-1',
        discountFingerprint: 'rule-1:2026-07-17T00:00:00.000Z',
      }),
    )
    expect(notifyDiscountAudienceMock).toHaveBeenCalledWith(
      expect.objectContaining({
        discountRuleId: 'rule-1',
        discountFingerprint: 'rule-1:2026-07-17T00:00:00.000Z',
        sellerName: 'Atelier Noa',
      }),
    )
  })

  it('does not skip the favorite/cart audience when the store-follower dispatch fails', async () => {
    notifyFollowersMock.mockRejectedValue(new Error('follow dispatch failed'))
    notifyDiscountAudienceMock.mockResolvedValue({ notified: 1 })

    await expect(
      processCampaignDiscountJob(
        fanOutJob({
          discountRuleId: 'rule-1',
          discountFingerprint: 'rule-1:2026-07-17T00:00:00.000Z',
          sellerId: 'seller-1',
          sellerName: 'Atelier Noa',
          sellerSlug: 'atelier-noa',
        }),
      ),
    ).resolves.toBeUndefined()

    expect(notifyDiscountAudienceMock).toHaveBeenCalledTimes(1)
  })

  it('does not skip the store-follower audience when the favorite/cart dispatch fails', async () => {
    notifyFollowersMock.mockResolvedValue(undefined)
    notifyDiscountAudienceMock.mockRejectedValue(new Error('audience dispatch failed'))

    await expect(
      processCampaignDiscountJob(
        fanOutJob({
          discountRuleId: 'rule-1',
          discountFingerprint: 'rule-1:2026-07-17T00:00:00.000Z',
          sellerId: 'seller-1',
          sellerName: 'Atelier Noa',
          sellerSlug: 'atelier-noa',
        }),
      ),
    ).resolves.toBeUndefined()

    expect(notifyFollowersMock).toHaveBeenCalledTimes(1)
  })

  it('throws (fails the job) only when both audiences fail', async () => {
    notifyFollowersMock.mockRejectedValue(new Error('follow dispatch failed'))
    notifyDiscountAudienceMock.mockRejectedValue(new Error('audience dispatch failed'))

    await expect(
      processCampaignDiscountJob(
        fanOutJob({
          discountRuleId: 'rule-1',
          discountFingerprint: 'rule-1:2026-07-17T00:00:00.000Z',
          sellerId: 'seller-1',
          sellerName: 'Atelier Noa',
          sellerSlug: 'atelier-noa',
        }),
      ),
    ).rejects.toThrow(/both audiences errored/)
  })
})

describe('campaign-discount.job — activation-scan', () => {
  beforeEach(() => {
    notifyFollowersMock.mockReset()
    notifyDiscountAudienceMock.mockReset()
    discountRuleFindManyMock.mockReset()
    discountRuleUpdateManyMock.mockReset()
    queueAddMock.mockReset()
  })

  it('flips SCHEDULED rules whose startsAt has passed to ACTIVE and enqueues one fan-out per rule', async () => {
    discountRuleFindManyMock.mockResolvedValue([
      {
        id: 'rule-due',
        startsAt: new Date('2026-07-16T00:00:00.000Z'),
        createdAt: new Date('2026-07-01T00:00:00.000Z'),
        seller: { id: 'seller-1', displayName: 'Atelier Noa', slug: 'atelier-noa' },
      },
    ])
    discountRuleFindManyMock.mockImplementationOnce(async () => [
      {
        id: 'rule-due',
        startsAt: new Date('2026-07-16T00:00:00.000Z'),
        createdAt: new Date('2026-07-01T00:00:00.000Z'),
        seller: { id: 'seller-1', displayName: 'Atelier Noa', slug: 'atelier-noa' },
      },
    ])
    discountRuleUpdateManyMock
      .mockResolvedValueOnce({ count: 1 }) // SCHEDULED -> ACTIVE transition succeeds
      .mockResolvedValueOnce({ count: 0 }) // ACTIVE -> EXPIRED sweep finds none

    const result = await processCampaignDiscountJob(activationScanJob())

    expect(discountRuleUpdateManyMock).toHaveBeenNthCalledWith(1, {
      where: { id: 'rule-due', status: 'SCHEDULED' },
      data: { status: 'ACTIVE' },
    })
    expect(queueAddMock).toHaveBeenCalledWith(
      'fan-out',
      expect.objectContaining({
        discountRuleId: 'rule-due',
        discountFingerprint: 'rule-due:2026-07-16T00:00:00.000Z',
        sellerId: 'seller-1',
        sellerName: 'Atelier Noa',
        sellerSlug: 'atelier-noa',
      }),
      expect.objectContaining({ attempts: 3 }),
    )
    expect(result).toEqual({ activated: 1, expired: 0 })
  })

  it('flips ACTIVE rules whose endsAt has passed to EXPIRED without enqueueing anything', async () => {
    discountRuleFindManyMock.mockResolvedValue([]) // no SCHEDULED rules due
    discountRuleUpdateManyMock.mockResolvedValueOnce({ count: 3 }) // expired sweep

    const result = await processCampaignDiscountJob(activationScanJob())

    expect(queueAddMock).not.toHaveBeenCalled()
    expect(result).toEqual({ activated: 0, expired: 3 })
  })

  it('is idempotent: skips enqueue when the guarded status transition finds the rule already moved', async () => {
    discountRuleFindManyMock.mockResolvedValue([
      {
        id: 'rule-race',
        startsAt: new Date('2026-07-16T00:00:00.000Z'),
        createdAt: new Date('2026-07-01T00:00:00.000Z'),
        seller: { id: 'seller-1', displayName: 'Atelier Noa', slug: 'atelier-noa' },
      },
    ])
    // Another worker already flipped this rule between the findMany read and this
    // run's guarded update — count: 0 means no rows matched the WHERE clause.
    discountRuleUpdateManyMock
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 0 })

    const result = await processCampaignDiscountJob(activationScanJob())

    expect(queueAddMock).not.toHaveBeenCalled()
    expect(result).toEqual({ activated: 0, expired: 0 })
  })
})
