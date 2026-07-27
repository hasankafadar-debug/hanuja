/**
 * Integration test — admin bulk product approval.
 *
 * Exercises the real `bulkPublishProducts` in api/services/catalog.service.ts
 * against a fake Prisma client, because the correctness that matters here is
 * which rows get written and which get skipped.
 *
 * Regression context: the admin moderation table used to fan out one HTTP
 * request per selected product and swallow every failure, so a whole batch
 * could fail silently. The service now returns an explicit per-id outcome.
 *
 * .claude/rules/10-admin-panel-rules.md, .claude/rules/11-testing-release-rules.md
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PrismaClient } from '@prisma/client'

const { enqueueProductSyncMock } = vi.hoisted(() => ({
  enqueueProductSyncMock: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../api/jobs/search-index-sync.job', () => ({
  enqueueProductSync: enqueueProductSyncMock,
  enqueueCategorySync: vi.fn().mockResolvedValue(undefined),
}))

import { createCatalogService } from '../../api/services/catalog.service'

interface FakeProduct {
  id: string
  status: string
  publishedAt: Date | null
  rejectedAt?: Date | null
  rejectionReason?: string | null
}

interface FakePrismaOptions {
  beforeUpdateManyAndReturn?: (callNumber: number, store: Map<string, FakeProduct>) => void
  failOnUpdateManyAndReturnCall?: number
}

function createFakePrisma(seed: FakeProduct[], options: FakePrismaOptions = {}) {
  const store = new Map(seed.map((product) => [product.id, { ...product }]))
  let updateManyAndReturnCalls = 0

  const productApi = {
    async findUnique({ where }: { where: { id: string } }) {
      return store.get(where.id) ?? null
    },
    async findMany({
      where,
      select,
    }: {
      where: { id: { in: string[] } }
      select?: { id?: boolean; status?: boolean; publishedAt?: boolean }
    }) {
      return where.id.in
        .filter((id) => store.has(id))
        .map((id) => {
          const product = store.get(id)!
          if (select && Object.keys(select).length === 1 && select.id) {
            return { id: product.id }
          }
          return {
            id: product.id,
            status: product.status,
            publishedAt: product.publishedAt,
          }
        })
    },
    async update({ where, data }: { where: { id: string }; data: Record<string, unknown> }) {
      const existing = store.get(where.id)
      if (!existing) throw new Error(`update on unknown product ${where.id}`)
      const next = { ...existing, ...data } as FakeProduct
      store.set(where.id, next)
      return next
    },
    async updateManyAndReturn({
      where,
      data,
      select,
    }: {
      where: {
        id: string | { in: string[] }
        status?: string
        publishedAt?: null | { not: null }
      }
      data: Record<string, unknown>
      select?: { id?: boolean }
    }) {
      updateManyAndReturnCalls += 1
      options.beforeUpdateManyAndReturn?.(updateManyAndReturnCalls, store)
      if (options.failOnUpdateManyAndReturnCall === updateManyAndReturnCalls) {
        throw new Error('simulated transaction write failure')
      }

      const ids = typeof where.id === 'string' ? [where.id] : where.id.in
      return ids
        .filter((id) => {
          const product = store.get(id)
          if (!product) return false
          if (where.status !== undefined && product.status !== where.status) return false
          if (where.publishedAt === null && product.publishedAt !== null) return false
          if (
            typeof where.publishedAt === 'object' &&
            where.publishedAt?.not === null &&
            product.publishedAt === null
          ) {
            return false
          }
          return true
        })
        .map((id) => {
          const existing = store.get(id)!
          const next = { ...existing, ...data } as FakeProduct
          store.set(id, next)
          return select?.id ? { id } : next
        })
    },
  }

  const prisma = {
    product: productApi,
    async $transaction(input: unknown) {
      if (typeof input === 'function') {
        const snapshot = new Map([...store.entries()].map(([id, product]) => [id, { ...product }]))
        try {
          return await input({ product: productApi })
        } catch (error) {
          store.clear()
          for (const [id, product] of snapshot) store.set(id, product)
          throw error
        }
      }
      return Promise.all(input as Array<Promise<unknown>>)
    },
  }

  return {
    prisma: prisma as unknown as PrismaClient,
    store,
    getUpdateManyAndReturnCalls: () => updateManyAndReturnCalls,
  }
}

const EARLIER_PUBLISH_DATE = new Date('2026-01-15T10:00:00.000Z')

describe('bulkPublishProducts', () => {
  beforeEach(() => {
    enqueueProductSyncMock.mockReset()
    enqueueProductSyncMock.mockResolvedValue(undefined)
  })

  it('approves only pending products and reports why the rest were skipped', async () => {
    const { prisma, store } = createFakePrisma([
      { id: 'p-pending-1', status: 'pending_review', publishedAt: null },
      { id: 'p-pending-2', status: 'pending_review', publishedAt: null },
      {
        id: 'p-published',
        status: 'published',
        publishedAt: EARLIER_PUBLISH_DATE,
      },
      { id: 'p-rejected', status: 'rejected', publishedAt: null },
      { id: 'p-draft', status: 'draft', publishedAt: null },
    ])
    const service = createCatalogService({ prisma })

    const result = await service.bulkPublishProducts(
      ['p-pending-1', 'p-pending-2', 'p-published', 'p-rejected', 'p-draft', 'p-missing'],
      'admin-1',
    )

    expect(result.approved.sort()).toEqual(['p-pending-1', 'p-pending-2'])
    expect(result.skipped).toEqual([
      { id: 'p-published', reason: 'not_pending' },
      { id: 'p-rejected', reason: 'not_pending' },
      { id: 'p-draft', reason: 'not_pending' },
      { id: 'p-missing', reason: 'not_found' },
    ])

    expect(store.get('p-pending-1')?.status).toBe('published')
    expect(store.get('p-pending-2')?.status).toBe('published')
    // A stale selection carried over from another page must never force-publish
    // a product the admin already rejected.
    expect(store.get('p-rejected')?.status).toBe('rejected')
    expect(store.get('p-draft')?.status).toBe('draft')
  })

  it('clears the rejection trail and stamps publishedAt on first publication', async () => {
    const { prisma, store } = createFakePrisma([
      {
        id: 'p-was-rejected-then-resubmitted',
        status: 'pending_review',
        publishedAt: null,
        rejectedAt: new Date('2026-02-01T00:00:00.000Z'),
        rejectionReason: 'Gorsel yetersiz',
      },
    ])
    const service = createCatalogService({ prisma })

    await service.bulkPublishProducts(['p-was-rejected-then-resubmitted'], 'admin-1')

    const row = store.get('p-was-rejected-then-resubmitted')
    expect(row?.status).toBe('published')
    expect(row?.rejectedAt).toBeNull()
    expect(row?.rejectionReason).toBeNull()
    expect(row?.publishedAt).toBeInstanceOf(Date)
  })

  it('preserves the original publishedAt when a previously published product is re-approved', async () => {
    const { prisma, store } = createFakePrisma([
      {
        id: 'p-edited',
        status: 'pending_review',
        publishedAt: EARLIER_PUBLISH_DATE,
      },
    ])
    const service = createCatalogService({ prisma })

    await service.bulkPublishProducts(['p-edited'], 'admin-1')

    expect(store.get('p-edited')?.publishedAt).toEqual(EARLIER_PUBLISH_DATE)
  })

  it('deduplicates repeated ids so a product is reported once', async () => {
    const { prisma } = createFakePrisma([{ id: 'p-dup', status: 'pending_review', publishedAt: null }])
    const service = createCatalogService({ prisma })

    const result = await service.bulkPublishProducts(['p-dup', 'p-dup', 'p-dup'], 'admin-1')

    expect(result.approved).toEqual(['p-dup'])
    expect(enqueueProductSyncMock).toHaveBeenCalledTimes(1)
  })

  it('approves 90 products atomically in one transaction', async () => {
    const seed = Array.from({ length: 90 }, (_, index) => ({
      id: `p-${index}`,
      status: 'pending_review',
      publishedAt: null,
    }))
    const { prisma, store, getUpdateManyAndReturnCalls } = createFakePrisma(seed)
    const service = createCatalogService({ prisma })

    const result = await service.bulkPublishProducts(
      seed.map((product) => product.id),
      'admin-1',
    )

    expect(result.approved).toHaveLength(90)
    expect(result.skipped).toHaveLength(0)
    expect([...store.values()].every((product) => product.status === 'published')).toBe(true)
    expect(getUpdateManyAndReturnCalls()).toBe(2)
    expect(enqueueProductSyncMock).toHaveBeenCalledTimes(90)
  })

  it('does not overwrite a concurrent moderation decision', async () => {
    const { prisma, store } = createFakePrisma([{ id: 'p-race', status: 'pending_review', publishedAt: null }], {
      beforeUpdateManyAndReturn(callNumber, currentStore) {
        if (callNumber === 1) {
          currentStore.set('p-race', {
            ...currentStore.get('p-race')!,
            status: 'rejected',
          })
        }
      },
    })
    const service = createCatalogService({ prisma })

    const result = await service.bulkPublishProducts(['p-race'], 'admin-1')

    expect(result.approved).toEqual([])
    expect(result.skipped).toEqual([{ id: 'p-race', reason: 'not_pending' }])
    expect(store.get('p-race')?.status).toBe('rejected')
    expect(enqueueProductSyncMock).not.toHaveBeenCalled()
  })

  it('rolls back every approval when any transaction write fails', async () => {
    const { prisma, store } = createFakePrisma(
      [
        {
          id: 'p-first-publication',
          status: 'pending_review',
          publishedAt: null,
        },
        {
          id: 'p-republication',
          status: 'pending_review',
          publishedAt: EARLIER_PUBLISH_DATE,
        },
      ],
      { failOnUpdateManyAndReturnCall: 2 },
    )
    const service = createCatalogService({ prisma })

    await expect(service.bulkPublishProducts(['p-first-publication', 'p-republication'], 'admin-1')).rejects.toThrow(
      'simulated transaction write failure',
    )

    expect(store.get('p-first-publication')?.status).toBe('pending_review')
    expect(store.get('p-first-publication')?.publishedAt).toBeNull()
    expect(store.get('p-republication')?.status).toBe('pending_review')
    expect(store.get('p-republication')?.publishedAt).toEqual(EARLIER_PUBLISH_DATE)
    expect(enqueueProductSyncMock).not.toHaveBeenCalled()
  })

  it('keeps the single-product state guard atomic', async () => {
    const { prisma, store } = createFakePrisma([{ id: 'p-single-race', status: 'pending_review', publishedAt: null }], {
      beforeUpdateManyAndReturn(callNumber, currentStore) {
        if (callNumber === 1) {
          currentStore.set('p-single-race', {
            ...currentStore.get('p-single-race')!,
            status: 'rejected',
          })
        }
      },
    })
    const service = createCatalogService({ prisma })

    await expect(service.publishProduct('p-single-race', 'admin-1')).rejects.toThrow('Urun artik inceleme beklemiyor')

    expect(store.get('p-single-race')?.status).toBe('rejected')
    expect(enqueueProductSyncMock).not.toHaveBeenCalled()
  })

  it('keeps approvals committed when search index sync fails', async () => {
    enqueueProductSyncMock.mockRejectedValueOnce(new Error('redis unreachable'))
    const { prisma, store } = createFakePrisma([{ id: 'p-sync-fail', status: 'pending_review', publishedAt: null }])
    const service = createCatalogService({ prisma })

    const result = await service.bulkPublishProducts(['p-sync-fail'], 'admin-1')

    expect(result.approved).toEqual(['p-sync-fail'])
    expect(store.get('p-sync-fail')?.status).toBe('published')
  })
})
