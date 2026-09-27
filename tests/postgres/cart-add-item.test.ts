/**
 * Adding a product that is already in the cart, against a real PostgreSQL database.
 *
 * The cart line unique index is (cartId, productId, variantId) with a nullable `variantId`,
 * and PostgreSQL treats NULLs as distinct, so the index cannot stop a second line for a
 * product without variants. The old upsert looked the line up with `variantId: ''` while
 * storing NULL, so every add created a new line. Row locks and NULL semantics are what
 * this depends on, which a mocked client cannot show.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { PrismaClient } from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/client'

const testUrl = process.env.NOTIFICATION_TEST_DATABASE_URL
if (!testUrl)
  throw new Error('NOTIFICATION_TEST_DATABASE_URL must point to disposable local hanuja_notification_test')
const url = new URL(testUrl)
if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/hanuja_notification_test')
  throw new Error('Refusing non-local notification test database')
const schema = `cart_add_${randomUUID().replaceAll('-', '')}`
url.searchParams.set('schema', schema)
url.searchParams.set('connection_limit', '10')
const prisma = new PrismaClient({ datasources: { db: { url: url.toString() } } })

import { createCartService } from '../../api/services/cart.service'
import { ValidationError } from '../../api/lib/errors'

const service = () => createCartService({ prisma })

beforeAll(async () => {
  execFileSync(
    process.execPath,
    [resolve('../db/node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--schema', resolve('../db/schema/schema.prisma')],
    { env: { ...process.env, DATABASE_URL: url.toString() }, stdio: 'pipe' },
  )
  await prisma.$connect()
}, 120_000)

afterAll(async () => {
  if (!/^cart_add_[a-f0-9]{32}$/.test(schema)) throw new Error('Unsafe test schema')
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
  await prisma.$disconnect()
})

async function seedCustomer() {
  return prisma.user.create({
    data: { email: `cart-${randomUUID().slice(0, 12)}@example.test`, name: 'Sepet Müşterisi', role: 'customer' },
  })
}

async function seedProduct(options: { stock?: number; variants?: number } = {}) {
  const suffix = randomUUID().slice(0, 12)
  const sellerUser = await prisma.user.create({ data: { email: `s-${suffix}@example.test`, role: 'seller' } })
  const seller = await prisma.seller.create({
    data: { userId: sellerUser.id, slug: `m-${suffix}`, displayName: `Mağaza ${suffix}`, status: 'active' },
  })
  const product = await prisma.product.create({
    data: {
      sellerId: seller.id,
      slug: `u-${suffix}`,
      name: 'Meşe Sehpa',
      status: 'published',
      price: new Decimal(1000),
      stockQuantity: options.stock ?? 10,
    },
  })
  const variants = []
  for (let index = 0; index < (options.variants ?? 0); index++) {
    variants.push(
      await prisma.productVariant.create({
        data: {
          productId: product.id,
          name: `Varyant ${index + 1}`,
          barcode: `8${randomUUID().replace(/\D/g, '').padEnd(12, '0').slice(0, 12)}`,
          price: new Decimal(1000 + index),
          stockQuantity: 10,
          options: {},
        },
      }),
    )
  }
  return { product, variants }
}

function linesFor(userId: string) {
  return prisma.cartItem.findMany({
    where: { cart: { userId } },
    select: { productId: true, variantId: true, quantity: true },
    orderBy: { createdAt: 'asc' },
  })
}

describe('cart add item — one line per product and variant', () => {
  it('raises the quantity of the existing line for a product without variants', async () => {
    const customer = await seedCustomer()
    const { product } = await seedProduct()

    for (let i = 0; i < 3; i++) {
      await service().addItem({ userId: customer.id, productId: product.id, quantity: 1 })
    }

    expect(await linesFor(customer.id)).toEqual([{ productId: product.id, variantId: null, quantity: 3 }])
  })

  it('keeps one line per variant and merges repeated adds of the same variant', async () => {
    const customer = await seedCustomer()
    const { product, variants } = await seedProduct({ variants: 2 })
    const [first, second] = variants

    await service().addItem({ userId: customer.id, productId: product.id, variantId: first!.id, quantity: 1 })
    await service().addItem({ userId: customer.id, productId: product.id, variantId: second!.id, quantity: 1 })
    await service().addItem({ userId: customer.id, productId: product.id, variantId: first!.id, quantity: 2 })

    const lines = await linesFor(customer.id)
    expect(lines).toHaveLength(2)
    expect(lines).toEqual(
      expect.arrayContaining([
        { productId: product.id, variantId: first!.id, quantity: 3 },
        { productId: product.id, variantId: second!.id, quantity: 1 },
      ]),
    )
  })

  it('does not create a second line when adds race (double tap)', async () => {
    const customer = await seedCustomer()
    const { product } = await seedProduct()
    await prisma.cart.create({ data: { userId: customer.id } })

    await Promise.all(
      Array.from({ length: 4 }, () => service().addItem({ userId: customer.id, productId: product.id, quantity: 1 })),
    )

    expect(await linesFor(customer.id)).toEqual([{ productId: product.id, variantId: null, quantity: 4 }])
  })

  it('folds duplicate lines left by the old upsert into one', async () => {
    const customer = await seedCustomer()
    const { product } = await seedProduct()
    const cart = await prisma.cart.create({ data: { userId: customer.id } })
    // The unique index allows these because variantId is NULL.
    for (let i = 0; i < 2; i++) {
      await prisma.cartItem.create({
        data: { cartId: cart.id, productId: product.id, quantity: 1, unitPrice: new Decimal(1000) },
      })
    }

    await service().addItem({ userId: customer.id, productId: product.id, quantity: 1 })

    expect(await linesFor(customer.id)).toEqual([{ productId: product.id, variantId: null, quantity: 3 }])
  })

  it('applies the stock limit to the total quantity of the product in the cart', async () => {
    const customer = await seedCustomer()
    const { product } = await seedProduct({ stock: 3 })

    for (let i = 0; i < 3; i++) {
      await service().addItem({ userId: customer.id, productId: product.id, quantity: 1 })
    }
    await expect(
      service().addItem({ userId: customer.id, productId: product.id, quantity: 1 }),
    ).rejects.toBeInstanceOf(ValidationError)

    expect(await linesFor(customer.id)).toEqual([{ productId: product.id, variantId: null, quantity: 3 }])
  })
})
