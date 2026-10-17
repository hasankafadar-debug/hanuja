import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { PrismaClient, type Prisma } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import {
  installCategoryCatalog,
  resolveCategorySchema,
} from '../../api/services/category-schema.service'
import {
  saveCatalogField,
  saveCatalogTemplate,
  saveManagedCategory,
} from '../../api/services/catalog-admin.service'
import { createCatalogService } from '../../api/services/catalog.service'
import { createCheckoutService } from '../../api/services/checkout.service'
import { releaseLineQuantity } from '../../api/services/order-line-release'
import { Decimal } from '@prisma/client/runtime/client'
import type { CatalogFieldDefinition, TemplateConfig } from '../../api/domain/category-schema'
vi.mock('../../api/jobs/search-index-sync.job', () => ({
  enqueueProductSync: vi.fn(async () => {}),
  enqueueCategorySync: vi.fn(async () => {}),
}))
vi.mock('../../api/lib/prisma', () => ({
  get prisma() {
    return db
  },
}))
const url = new URL(process.env.CATEGORY_TEST_DATABASE_URL ?? '')
if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/hanuja_category_test')
  throw new Error('Disposable local category test database required')
const schema = `category_test_${randomUUID().replaceAll('-', '')}`
url.searchParams.set('schema', schema)
const db = new PrismaClient({ datasources: { db: { url: url.toString() } } })
let sellerId: string, adminId: string, categoryId: string
beforeAll(async () => {
  execFileSync(
    process.execPath,
    [
      resolve('../db/node_modules/prisma/build/index.js'),
      'migrate',
      'deploy',
      '--schema',
      resolve('../db/schema/schema.prisma'),
    ],
    { env: { ...process.env, DATABASE_URL: url.toString() }, stdio: 'pipe' },
  )
  await installCategoryCatalog(db)
  const admin = await db.user.create({
    data: { email: `admin-${schema}@example.test`, role: 'admin' },
  })
  adminId = admin.id
  const sellerUser = await db.user.create({
    data: { email: `seller-${schema}@example.test`, role: 'seller' },
  })
  const seller = await db.seller.create({
    data: { userId: sellerUser.id, slug: schema, displayName: 'Category tests', status: 'active' },
  })
  sellerId = seller.id
  categoryId = (await db.category.findFirstOrThrow({ where: { name: 'Sweatshirt' } })).id
}, 120_000)
afterAll(async () => {
  if (!/^category_test_[a-f0-9]{32}$/.test(schema)) throw new Error('Invalid test schema')
  await db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
  await db.$disconnect()
})
async function product(stock = 1, status: 'published' | 'unlisted' = 'published') {
  return db.product.create({
    data: {
        brand: 'Test Brand',
      sellerId,
      categoryId,
      name: 'Test Sweatshirt',
      slug: `p-${randomUUID()}`,
      price: 100,
      status,
      stockQuantity: stock,
      properties: { cinsiyet: 'unisex', yas_grubu: 'yetiskin' },
      variants: {
        create: {
          name: 'M',
          options: { Beden: 'M' },
          price: 100,
          stockQuantity: stock,
          properties: { beden: 'M' },
          barcode: `8${randomUUID().replaceAll('-', '').replace(/[a-f]/g, '1').slice(0, 12)}`,
        },
      },
    },
    include: { variants: true },
  })
}
async function buyer(productId: string, variantId: string) {
  const user = await db.user.create({
    data: { email: `buyer-${randomUUID()}@example.test`, name: 'Test Buyer' },
  })
  const address = await db.address.create({
    data: {
      userId: user.id,
      fullName: 'Test Buyer',
      phone: '5551112233',
      addressLine1: 'Test Sokak 1',
      district: 'Kadıköy',
      city: 'İstanbul',
      postalCode: '34000',
    },
  })
  await db.cart.create({
    data: {
      userId: user.id,
      items: { create: { productId, variantId, quantity: 1, unitPrice: 100 } },
    },
  })
  return {
    userId: user.id,
    addressId: address.id,
    paymentMethod: 'eft' as const,
    legalAcceptance: {
      acceptedAt: new Date(),
      ipAddress: '127.0.0.1',
      userAgent: 'vitest',
      sessionId: null,
    },
  }
}
describe('real category publication and schema transactions', () => {
  it('installs idempotently and protects first publication through unlist and direct writes', async () => {
    const count = await db.category.count()
    await installCategoryCatalog(db)
    expect(await db.category.count()).toBe(count)
    const p = await db.product.create({
      data: {
        brand: 'Test Brand',
        sellerId,
        categoryId,
        slug: `p-${randomUUID()}`,
        name: 'Draft',
        price: 100,
        status: 'draft',
      },
    })
    expect(p.firstPublishedAt).toBeNull()
    const published = await db.product.update({
      where: { id: p.id },
      data: { status: 'published' },
    })
    expect(published.firstPublishedAt).toBeInstanceOf(Date)
    await db.product.update({
      where: { id: p.id },
      data: { status: 'unlisted', publishedAt: null },
    })
    await expect(
      db.product.update({ where: { id: p.id }, data: { firstPublishedAt: null } }),
    ).rejects.toThrow('immutable')
    expect((await db.product.findUniqueOrThrow({ where: { id: p.id } })).firstPublishedAt).toEqual(
      published.firstPublishedAt,
    )
  })
  it('uses historical evidence when a legacy unlisted product republishes before backfill', async () => {
    const p = await product(1, 'unlisted')
    expect(p.firstPublishedAt).toBeNull()
    await buyer(p.id, p.variants[0]!.id)
    const earlier = new Date('2026-01-01T12:00:00Z')
    await db.cartItem.updateMany({ where: { productId: p.id }, data: { createdAt: earlier } })
    const republished = await db.product.update({
      where: { id: p.id },
      data: { status: 'published', publishedAt: new Date() },
    })
    expect(republished.firstPublishedAt).toEqual(earlier)
  })
  it('retains all values when a template removes and restores a field; versions stay isolated', async () => {
    const p = await product(),
      template = await db.catalogTemplate.findUniqueOrThrow({ where: { code: 'GIY-UST' } }),
      other = await db.catalogTemplate.findUniqueOrThrow({ where: { code: 'KOZ-PARFUM' } })
    const original = template.config as unknown as TemplateConfig,
      next = structuredClone(original)
    next.fields = next.fields.filter((f) => f.key !== 'cinsiyet')
    const preview = await saveCatalogTemplate(db, adminId, {
      code: template.code,
      label: template.label,
      config: next,
      preview: true,
    })
    await saveCatalogTemplate(db, adminId, {
      code: template.code,
      label: template.label,
      config: next,
      confirmationToken: preview.confirmationToken,
    })
    expect((await db.product.findUniqueOrThrow({ where: { id: p.id } })).properties).toMatchObject({
      cinsiyet: 'unisex',
    })
    expect(
      (await resolveCategorySchema(db, categoryId)).config.fields.some((f) => f.key === 'cinsiyet'),
    ).toBe(false)
    const restore = await saveCatalogTemplate(db, adminId, {
      code: template.code,
      label: template.label,
      config: original,
      preview: true,
    })
    await saveCatalogTemplate(db, adminId, {
      code: template.code,
      label: template.label,
      config: original,
      confirmationToken: restore.confirmationToken,
    })
    expect(
      (await db.catalogTemplate.findUniqueOrThrow({ where: { code: template.code } }))
        .compatibilityVersion,
    ).toBe(template.compatibilityVersion + 2)
    expect(
      (await db.catalogTemplate.findUniqueOrThrow({ where: { code: other.code } }))
        .compatibilityVersion,
    ).toBe(other.compatibilityVersion)
  })
  it('blocks a canonical unit change racing the first committed value', async () => {
    const field: CatalogFieldDefinition = {
      key: 'race_volume',
      label: 'Race Volume',
      kind: 'number',
      canonicalUnit: 'ml',
      config: { measurement: 'Hacim' },
    }
    await saveCatalogField(db, adminId, field)
    await saveCatalogTemplate(db, adminId, {
      code: 'RACE',
      label: 'Race',
      config: {
        fields: [{ key: field.key, required: true }],
        requiredGroups: [],
        variantKey: null,
        variantLabel: null,
        contentKeys: [],
        shared: { color: false, material: false, dimensions: false },
        materialLabels: [],
      },
    })
    const category = await saveManagedCategory(db, adminId, { name: 'Race', templateCode: 'RACE' })
    let release!: () => void, ready!: () => void
    const gate = new Promise<void>((r) => {
        release = r
      }),
      started = new Promise<void>((r) => {
        ready = r
      })
    const writer = db.$transaction(
      async (tx) => {
        await resolveCategorySchema(tx, category.category!.id)
        ready()
        await gate
        return createCatalogService({ prisma: tx as unknown as PrismaClient }).createProduct({
          sellerId,
          categoryId: category.category!.id,
          name: 'Race Value',
          description: 'Test',
          price: new Decimal(100),
          fulfillmentDays: 1,
          stockQuantity: 1,
          modelCode: 'RACE',
          properties: { race_volume: '1 L' },
        })
      },
      { timeout: 10_000 },
    )
    await started
    const editor = saveCatalogField(db, adminId, { ...field, canonicalUnit: 'L' }).then(
      () => ({ allowed: true }),
      (error) => ({ allowed: false, error: String(error) }),
    )
    let blocked = false
    for (let i = 0; i < 100; i++) {
      const [row] = await db.$queryRaw<
        Array<{ count: bigint }>
      >`SELECT COUNT(*) AS count FROM pg_locks WHERE locktype='advisory' AND objid=82910214 AND NOT granted`
      if (Number(row?.count) > 0) {
        blocked = true
        break
      }
      await new Promise((r) => setTimeout(r, 10))
    }
    release()
    const saved = await writer,
      result = await editor
    expect(blocked).toBe(true)
    expect(result.allowed).toBe(false)
    expect(saved.properties).toMatchObject({ race_volume: 1000 })
    expect(
      (await db.catalogField.findUniqueOrThrow({ where: { key: field.key } })).canonicalUnit,
    ).toBe('ml')
  })
  it('rejects duplicate barcodes in the live creation service rather than silently replacing them', async () => {
    const category = await db.category.findFirstOrThrow({
        where: { name: 'Makyaj Fırçası & Aksesuarı' },
      }),
      code = '8691234567890'
    const service = createCatalogService({ prisma: db }),
      input = {
        sellerId,
        categoryId: category.id,
        name: 'Test Brush',
        description: 'Test brush',
        price: new Decimal(100),
        fulfillmentDays: 1,
        stockQuantity: 1,
        modelCode: 'BRUSH',
        barcode: code,
        autoGenerateBarcodeWhenMissing: true,
      }
    await service.createProduct(input)
    await expect(service.createProduct(input)).rejects.toThrow(/barkod|barcode/i)
    expect(await db.product.count({ where: { barcode: code } })).toBe(1)
  })
})
describe('real PostgreSQL stock races and durable dirty state', () => {
  it('allows only one checkout for the last variant and snapshots its actual size', async () => {
    const p = await product(),
      variant = p.variants[0]!,
      a = await buyer(p.id, variant.id),
      b = await buyer(p.id, variant.id)
    const results = await Promise.allSettled([
      createCheckoutService({ prisma: db }).createOrder(a),
      createCheckoutService({ prisma: db }).createOrder(b),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const saved = await db.product.findUniqueOrThrow({
      where: { id: p.id },
      include: { variants: true },
    })
    expect(saved.stockQuantity).toBe(0)
    expect(saved.variants[0]!.stockQuantity).toBe(0)
    const line = await db.orderLine.findFirstOrThrow({ where: { productId: p.id } })
    expect(line.propertiesSnapshot).toEqual(
      expect.arrayContaining([expect.objectContaining({ label: 'Beden', value: 'M' })]),
    )
    const dirty = await db.searchIndexDirtyProduct.findUnique({ where: { productId: p.id } })
    expect(dirty).not.toBeNull()
    const cancellations = await Promise.allSettled([
      db.$transaction((tx) => releaseLineQuantity(tx, line, 1)),
      db.$transaction((tx) => releaseLineQuantity(tx, line, 1)),
    ])
    expect(cancellations.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const restored = await db.product.findUniqueOrThrow({
      where: { id: p.id },
      include: { variants: true },
    })
    expect(restored.stockQuantity).toBe(1)
    expect(restored.variants[0]!.stockQuantity).toBe(1)
  })
  it('keeps dirty revisions after a concurrent update instead of acknowledging new work', async () => {
    const p = await product(),
      dirty = await db.searchIndexDirtyProduct.findUniqueOrThrow({ where: { productId: p.id } })
    await db.productVariant.update({ where: { id: p.variants[0]!.id }, data: { stockQuantity: 2 } })
    expect(
      (
        await db.searchIndexDirtyProduct.deleteMany({
          where: { productId: p.id, revision: dirty.revision },
        })
      ).count,
    ).toBe(0)
    const before = await db.searchIndexDirtyProduct.findUniqueOrThrow({
      where: { productId: p.id },
    })
    await db.seller.update({ where: { id: sellerId }, data: { vacationModeEnabled: true } })
    expect(
      (await db.searchIndexDirtyProduct.findUniqueOrThrow({ where: { productId: p.id } })).revision,
    ).toBeGreaterThan(before.revision)
    await db.seller.update({ where: { id: sellerId }, data: { vacationModeEnabled: false } })
  })
})
