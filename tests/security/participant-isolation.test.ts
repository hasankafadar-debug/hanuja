import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'

const mocks = vi.hoisted(() => ({ prisma: vi.fn(), read: vi.fn() }))
vi.mock('../../api/lib/prisma', () => ({ createPrismaForRoute: mocks.prisma }))
vi.mock('../../api/lib/r2', () => ({
  readObject: mocks.read, getMediaMaxSizeBytes: () => 10 * 1024 * 1024,
  generatePresignedUploadUrl: vi.fn(), deleteObject: vi.fn(), uploadObject: vi.fn(), SLIDER_VIDEO_MIME_TYPES: new Set(),
}))
import { fetchPrivateMedia } from '../../api/routes/media'
import { createDisputeRepository } from '../../api/repositories/dispute.repository'

// Evaluate the actual query against fixtures. This is a generic subset of Prisma
// predicates, not a second implementation of the participant authorization rule.
type Row = Record<string, unknown>
function matches(row: unknown, where: unknown): boolean {
  if (where === null || typeof where !== 'object') return row === where
  return Object.entries(where as Row).every(([key, value]) => {
    if (key === 'OR') return (value as unknown[]).some(part => matches(row, part))
    if (key === 'AND') return (value as unknown[]).every(part => matches(row, part))
    if (key === 'is') return matches(row, value)
    if (key === 'not') return !matches(row, value)
    if (key === 'some') return Array.isArray(row) && row.some(part => matches(part, value))
    if (row === null || typeof row !== 'object') return false
    return matches((row as Row)[key], value)
  })
}
const order = { customerId: 'customer-a', lines: [{ sellerId: 'seller-a' }, { sellerId: 'seller-b' }] }
let returnRequest: Row
let dispute: Row
let asset: Row
let prisma: ReturnType<typeof fixturePrisma>
function fixturePrisma() {
  return {
    seller: { findUnique: vi.fn(async ({ where }: { where: { userId: string } }) => (
      where.userId === 'user-a' ? { id: 'seller-a' } : where.userId === 'user-b' ? { id: 'seller-b' } : null
    )) },
    mediaAsset: { findFirst: vi.fn(async ({ where }: { where: unknown }) => matches(asset, where) ? asset : null) },
    dispute: {
      findFirst: vi.fn(async ({ where }: { where: unknown }) => matches(dispute, where) ? dispute : null),
      findUnique: vi.fn(async () => dispute),
    },
  }
}
beforeEach(() => {
  vi.clearAllMocks()
  returnRequest = { sellerId: 'seller-a', customerId: 'customer-a', order }
  dispute = { id: 'dispute-a', order, escalatedFromReturn: returnRequest }
  asset = {
    id: 'asset-a', status: 'ready', key: 'returns/customer-a/fixture.jpg', folder: 'returns', uploadedBy: 'customer-a',
    returnRequest, dispute: null, returnMessage: null, supportAttachments: [], customerSupportAttachments: [],
  }
  prisma = fixturePrisma()
  mocks.prisma.mockReturnValue(prisma)
  mocks.read.mockResolvedValue({ body: new Uint8Array([1]), contentType: 'image/jpeg', sizeBytes: 1 })
})

describe('multi-seller private media through the real handler', () => {
  it.each(['evidence', 'message', 'escalated dispute'])('denies seller B access to seller A %s', async kind => {
    if (kind === 'message') { asset.returnRequest = null; asset.returnMessage = { returnRequest } }
    if (kind === 'escalated dispute') { asset.returnRequest = null; asset.dispute = dispute }
    const response = await fetchPrivateMedia('asset-a', { viewerId: 'user-b', viewerRole: 'seller' })
    expect(response.status).toBe(404)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(mocks.read).not.toHaveBeenCalled()
  })
  it.each([
    ['user-a', 'seller'], ['customer-a', 'customer'], ['staff-a', 'admin'],
  ] as const)('preserves access for %s (%s)', async (viewerId, viewerRole) => {
    expect((await fetchPrivateMedia('asset-a', { viewerId, viewerRole })).status).toBe(200)
    expect(mocks.read).toHaveBeenCalledOnce()
  })
  it('denies an unrelated customer and a customer role with a seller identity', async () => {
    expect((await fetchPrivateMedia('asset-a', { viewerId: 'other-customer', viewerRole: 'customer' })).status).toBe(404)
    expect((await fetchPrivateMedia('asset-a', { viewerId: 'user-a', viewerRole: 'customer' })).status).toBe(404)
    expect(prisma.seller.findUnique).not.toHaveBeenCalled()
    expect(mocks.read).not.toHaveBeenCalled()
  })
  it('preserves legacy order-wide returns without a sellerId', async () => {
    returnRequest.sellerId = null
    expect((await fetchPrivateMedia('asset-a', { viewerId: 'user-b', viewerRole: 'seller' })).status).toBe(200)
  })
})

describe('real dispute repository scopes both reads and message targets', () => {
  it.each(['findByIdForViewer', 'findMessageTargetForViewer'] as const)('%s denies the other seller and allows the participants', async method => {
    const repository = createDisputeRepository(prisma as unknown as PrismaClient)
    expect(await repository[method]('dispute-a', { viewerId: 'user-b', viewerRole: 'seller' })).toBeNull()
    expect(await repository[method]('dispute-a', { viewerId: 'user-a', viewerRole: 'seller' })).toEqual(dispute)
    expect(await repository[method]('dispute-a', { viewerId: 'customer-a', viewerRole: 'customer' })).toEqual(dispute)
    expect(await repository[method]('dispute-a', { viewerId: 'staff-a', viewerRole: 'admin' })).toEqual(dispute)
  })
  it.each(['direct', 'legacy'])('preserves %s order-wide disputes', async kind => {
    if (kind === 'direct') dispute.escalatedFromReturn = null
    else returnRequest.sellerId = null
    const repository = createDisputeRepository(prisma as unknown as PrismaClient)
    expect(await repository.findByIdForViewer('dispute-a', { viewerId: 'user-b', viewerRole: 'seller' })).toEqual(dispute)
  })
})
