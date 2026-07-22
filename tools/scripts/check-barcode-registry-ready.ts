import { PrismaClient } from '@prisma/client'

async function main() {
  const prisma = new PrismaClient()
  try {
    const conflicts = await prisma.$queryRaw<Array<{ barcode: string; productId: string; variantId: string }>>`
      SELECT p."barcode", p."id" AS "productId", v."id" AS "variantId"
      FROM "products" p
      INNER JOIN "product_variants" v ON v."barcode" = p."barcode"
      WHERE p."barcode" IS NOT NULL
      ORDER BY p."barcode"
    `
    if (conflicts.length > 0) {
      console.error('Product/variant barcode conflicts block the BarcodeRegistry migration:')
      for (const conflict of conflicts) console.error(`${conflict.barcode}: product=${conflict.productId}, variant=${conflict.variantId}`)
      process.exitCode = 1
      return
    }
    console.log('BarcodeRegistry preflight passed: no product/variant barcode conflicts found.')
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
