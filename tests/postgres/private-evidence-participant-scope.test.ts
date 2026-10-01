/**
 * Private return/dispute evidence on a multi-seller order, against a real
 * PostgreSQL database.
 *
 * The unit tests evaluate the generated Prisma `where` with an in-memory
 * predicate. This file proves the same rules with the real client and real
 * relation filters (`is`, nested `OR`, `escalatedFromReturn: { is: null }`):
 * the seller a return is assigned to keeps access, the other seller on the
 * same order loses it, and legacy order-wide cases stay shared.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { PrismaClient } from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/client'

const readObject = vi.hoisted(() => vi.fn())
vi.mock('../../api/lib/prisma', () => ({
  createPrismaForRoute: () => prisma,
  get prisma() {
    return prisma
  },
}))
vi.mock('../../api/lib/r2', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/lib/r2')>()),
  readObject,
}))

const testUrl = process.env.NOTIFICATION_TEST_DATABASE_URL
if (!testUrl)
  throw new Error('NOTIFICATION_TEST_DATABASE_URL must point to disposable local hanuja_notification_test')
const url = new URL(testUrl)
if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/hanuja_notification_test')
  throw new Error('Refusing non-local notification test database')
const schema = `evidence_scope_${randomUUID().replaceAll('-', '')}`
url.searchParams.set('schema', schema)
const prisma = new PrismaClient({ datasources: { db: { url: url.toString() } } })

import { fetchPrivateMedia, type PrivateMediaViewer } from '../../api/routes/media'
import { createDisputeRepository } from '../../api/repositories/dispute.repository'

beforeAll(async () => {
  execFileSync(
    process.execPath,
    [resolve('../db/node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--schema', resolve('../db/schema/schema.prisma')],
    { env: { ...process.env, DATABASE_URL: url.toString() }, stdio: 'pipe' },
  )
  await prisma.$connect()
  readObject.mockResolvedValue({ body: new Uint8Array([1, 2, 3]), contentType: 'image/jpeg', sizeBytes: 3 })
  fixture = await seed()
})

afterAll(async () => {
  if (!/^evidence_scope_[a-f0-9]{32}$/.test(schema)) throw new Error('Unsafe test schema')
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
  await prisma.$disconnect()
})

type Seeded = Awaited<ReturnType<typeof seed>>
let fixture: Seeded

async function seed() {
  const suffix = randomUUID().slice(0, 8)
  const user = (role: 'customer' | 'seller' | 'admin', name: string) =>
    prisma.user.create({ data: { email: `${name}-${suffix}@example.test`, name, role } })
  const customer = await user('customer', 'musteri')
  const outsider = await user('customer', 'yabanci')
  const admin = await user('admin', 'admin')
  const sellerUserA = await user('seller', 'satici-a')
  const sellerUserB = await user('seller', 'satici-b')
  const sellerA = await prisma.seller.create({
    data: { userId: sellerUserA.id, slug: `a-${suffix}`, displayName: 'Atelier A', status: 'active' },
  })
  const sellerB = await prisma.seller.create({
    data: { userId: sellerUserB.id, slug: `b-${suffix}`, displayName: 'Atelier B', status: 'active' },
  })
  const category = await prisma.category.create({ data: { slug: `kategori-${suffix}`, name: 'Mobilya' } })
  const product = (sellerId: string, name: string) =>
    prisma.product.create({
      data: { sellerId, categoryId: category.id, slug: `${name}-${suffix}`, name, price: new Decimal('100.00'), stockQuantity: 5 },
    })
  const productA = await product(sellerA.id, 'urun-a')
  const productB = await product(sellerB.id, 'urun-b')
  const address = await prisma.address.create({
    data: {
      userId: customer.id, fullName: 'Ayşe Yılmaz', phone: '5551112233', addressLine1: 'Atölye Sk. 3',
      district: 'Kadıköy', city: 'İstanbul', postalCode: '34000',
    },
  })
  const line = (productId: string, sellerId: string, productName: string) => ({
    productId, sellerId, productName, quantity: 1,
    unitPrice: new Decimal('100.00'), totalPrice: new Decimal('100.00'),
    customerPaidProductAmount: new Decimal('100.00'), netPayoutAmount: new Decimal('100.00'),
  })
  const order = await prisma.order.create({
    data: {
      customerId: customer.id, addressId: address.id, status: 'return_requested',
      grossAmount: new Decimal('200.00'), totalAmount: new Decimal('200.00'),
      lines: { create: [line(productA.id, sellerA.id, 'Ürün A'), line(productB.id, sellerB.id, 'Ürün B')] },
    },
  })

  const escalatedDispute = await prisma.dispute.create({
    data: { orderId: order.id, openedById: sellerUserA.id, reason: 'İade reddi' },
  })
  const directDispute = await prisma.dispute.create({
    data: { orderId: order.id, openedById: customer.id, reason: 'Eksik ürün' },
  })
  const returnBase = { orderId: order.id, customerId: customer.id, reason: 'Hasarlı', isWithinWindow: true }
  const assignedReturn = await prisma.returnRequest.create({
    data: { ...returnBase, sellerId: sellerA.id, requestKey: 'a', disputeId: escalatedDispute.id },
  })
  const legacyReturn = await prisma.returnRequest.create({
    data: { ...returnBase, sellerId: null, requestKey: 'legacy' },
  })
  const message = await prisma.returnMessage.create({
    data: { returnRequestId: assignedReturn.id, authorId: customer.id, authorRole: 'customer', body: 'Fotoğraflar ekte' },
  })

  const media = (type: 'return_evidence' | 'dispute_evidence', link: Record<string, string>) =>
    prisma.mediaAsset.create({
      data: {
        type, url: '', key: `private/${randomUUID()}`, folder: type === 'return_evidence' ? 'returns' : 'disputes',
        status: 'ready', uploadedBy: customer.id, ...link,
      },
    })

  return {
    viewers: {
      customer: { viewerId: customer.id, viewerRole: 'customer' },
      outsider: { viewerId: outsider.id, viewerRole: 'customer' },
      admin: { viewerId: admin.id, viewerRole: 'admin' },
      sellerA: { viewerId: sellerUserA.id, viewerRole: 'seller' },
      sellerB: { viewerId: sellerUserB.id, viewerRole: 'seller' },
    } satisfies Record<string, PrivateMediaViewer>,
    disputes: { escalated: escalatedDispute.id, direct: directDispute.id },
    media: {
      assignedReturn: (await media('return_evidence', { returnRequestId: assignedReturn.id })).id,
      assignedMessage: (await media('return_evidence', { returnMessageId: message.id })).id,
      escalatedDispute: (await media('dispute_evidence', { disputeId: escalatedDispute.id })).id,
      legacyReturn: (await media('return_evidence', { returnRequestId: legacyReturn.id })).id,
      directDispute: (await media('dispute_evidence', { disputeId: directDispute.id })).id,
    },
  }
}

type Viewer = keyof Seeded['viewers']
type Asset = keyof Seeded['media']

async function status(asset: Asset, viewer: Viewer) {
  return (await fetchPrivateMedia(fixture.media[asset], fixture.viewers[viewer])).status
}

describe('private evidence on a two-seller order (real PostgreSQL)', () => {
  it.each(['assignedReturn', 'assignedMessage', 'escalatedDispute'] as const)(
    '%s: assigned seller, customer and admin can read; the other seller and an outsider get 404',
    async (asset) => {
      expect(await status(asset, 'sellerA')).toBe(200)
      expect(await status(asset, 'customer')).toBe(200)
      expect(await status(asset, 'admin')).toBe(200)
      expect(await status(asset, 'sellerB')).toBe(404)
      expect(await status(asset, 'outsider')).toBe(404)
    },
  )

  it.each(['legacyReturn', 'directDispute'] as const)(
    '%s stays shared with every seller on the order',
    async (asset) => {
      expect(await status(asset, 'sellerA')).toBe(200)
      expect(await status(asset, 'sellerB')).toBe(200)
      expect(await status(asset, 'customer')).toBe(200)
      expect(await status(asset, 'outsider')).toBe(404)
    },
  )
})

describe('dispute repository participant scope (real PostgreSQL)', () => {
  const repo = () => createDisputeRepository(prisma)
  const find = async (method: 'findByIdForViewer' | 'findMessageTargetForViewer', dispute: 'escalated' | 'direct', viewer: Viewer) =>
    (await repo()[method](fixture.disputes[dispute], fixture.viewers[viewer]))?.id ?? null

  it.each(['findByIdForViewer', 'findMessageTargetForViewer'] as const)(
    '%s limits an escalated dispute to the assigned seller',
    async (method) => {
      expect(await find(method, 'escalated', 'sellerA')).toBe(fixture.disputes.escalated)
      expect(await find(method, 'escalated', 'customer')).toBe(fixture.disputes.escalated)
      expect(await find(method, 'escalated', 'sellerB')).toBeNull()
      expect(await find(method, 'escalated', 'outsider')).toBeNull()
    },
  )

  it.each(['findByIdForViewer', 'findMessageTargetForViewer'] as const)(
    '%s keeps a direct order-wide dispute visible to both sellers',
    async (method) => {
      expect(await find(method, 'direct', 'sellerA')).toBe(fixture.disputes.direct)
      expect(await find(method, 'direct', 'sellerB')).toBe(fixture.disputes.direct)
      expect(await find(method, 'direct', 'outsider')).toBeNull()
    },
  )
})
