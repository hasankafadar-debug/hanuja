import { PrismaClient } from '@prisma/client'
import { CUSTOMER_FIXTURE, TEST_EMAIL } from './customer-fixture-data'

async function main() {
  const prisma = new PrismaClient()

  try {
    const [customer, product] = await Promise.all([
      prisma.user.findUnique({
        where: { email: TEST_EMAIL },
        select: { id: true },
      }),
      prisma.product.findUnique({
        where: { slug: CUSTOMER_FIXTURE.productSlug },
        select: {
          id: true,
          slug: true,
          status: true,
          stockQuantity: true,
          seller: { select: { slug: true } },
        },
      }),
    ])

    if (!customer) throw new Error(`Test customer not found: ${TEST_EMAIL}`)
    if (!product) throw new Error(`Test product not found: ${CUSTOMER_FIXTURE.productSlug}`)
    if (product.seller.slug !== CUSTOMER_FIXTURE.storeSlug) {
      throw new Error(`Unexpected product seller: ${product.seller.slug}`)
    }
    if (product.status !== 'published' || product.stockQuantity < 1) {
      throw new Error(`Test product is not purchasable: ${product.slug}`)
    }

    await prisma.productAnalyticsEvent.deleteMany({
      where: {
        productId: product.id,
        userId: customer.id,
      },
    })
    await prisma.favoriteProduct.deleteMany({
      where: {
        productId: product.id,
        userId: customer.id,
      },
    })
    await prisma.cartItem.deleteMany({
      where: {
        productId: product.id,
        cart: { userId: customer.id },
      },
    })
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error) => {
  console.error('cleanup-seller-product-report failed:', error)
  process.exit(1)
})
