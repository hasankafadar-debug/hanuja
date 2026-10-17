import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { formatBrandedProductName } from '../../api/domain/product-brand'

async function main() {
  const db = new PrismaClient()
  const apply = process.argv.includes('--apply')
  try {
    const seller = await db.seller.findUnique({
      where: { slug: 'mosaiss' },
      select: { id: true, status: true },
    })
    if (!seller || seller.status !== 'active')
      throw new Error('Exactly one active mosaiss designer is required.')
    const products = await db.product.findMany({
      where: { sellerId: seller.id },
      orderBy: { id: 'asc' },
      select: { id: true, name: true, brand: true, slug: true },
    })
    if (products.some((p) => p.brand && p.brand.toLocaleLowerCase('tr-TR').replace(/ı/g, 'i') !== 'mosaiss'))
      throw new Error('A product already has a different brand; inspect before backfill.')
    const changes = products
      .map((p) => ({ ...p, nextName: formatBrandedProductName(p.name, 'Mosaiss', p.brand) }))
      .filter((p) => p.name !== p.nextName || p.brand !== 'Mosaiss')
    const folder = resolve('.tmp/product-brand')
    await mkdir(folder, { recursive: true })
    const audit = resolve(
      folder,
      'mosaiss-' + (apply ? 'apply-' : 'dry-run-') + Date.now() + '.json',
    )
    await writeFile(
      audit,
      JSON.stringify({ mode: apply ? 'apply' : 'dry-run', sellerId: seller.id, changes }, null, 2),
    )
    if (apply) {
      const { enqueueProductSync } = await import('../../api/jobs/search-index-sync.job')
      await db.$transaction(async (tx) => {
        for (const p of changes) {
          const updated = await tx.product.updateMany({
            where: { id: p.id, sellerId: seller.id, name: p.name, brand: p.brand },
            data: { brand: 'Mosaiss', name: p.nextName },
          })
          if (updated.count !== 1) throw new Error('Product changed during backfill: ' + p.id)
        }
      })
      // Re-enqueue all products on every apply so retries also repair an interrupted indexing pass.
      for (const p of products) await enqueueProductSync({ operation: 'upsert', entityId: p.id })
    }
    console.log(
      JSON.stringify({
        mode: apply ? 'apply' : 'dry-run',
        products: products.length,
        changed: changes.length,
        missingBrands: (await db.$queryRaw<Array<{ count: number }>>`SELECT COUNT(*)::int AS count FROM products WHERE "brand" IS NULL OR length(trim("brand")) = 0`)[0]!.count,
        audit,
      }),
    )
  } finally {
    await db.$disconnect()
  }
}
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : 'Brand backfill failed')
    process.exit(1)
  })
