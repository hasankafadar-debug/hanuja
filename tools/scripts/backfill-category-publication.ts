import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { lockProductStocks } from '../../api/domain/product-stock'

async function main() {
  const db = new PrismaClient()
  try {
    const reconcileStockOnly = process.argv.includes('--reconcile-stock')
    const installed = await db.catalogInstallation.findUnique({
      where: { id: 'publication-stock-backfill-v1' },
    })
    if (process.argv.includes('--apply') && installed && !reconcileStockOnly) {
      console.log(JSON.stringify({ alreadyApplied: true }))
      return
    }
    const report = await db.$queryRaw<
      Array<{
        id: string
        status: string
        firstPublishedAt: Date | null
        earliestAt: Date | null
        sources: unknown
      }>
    >`SELECT p.id,p.status,p."firstPublishedAt",e."earliestAt",e.sources FROM products p LEFT JOIN product_publication_evidence e ON e."productId"=p.id ORDER BY p.id`
    const candidates = report.filter(
      (p) =>
        !reconcileStockOnly &&
        !p.firstPublishedAt &&
        (p.earliestAt || ['published', 'unlisted'].includes(p.status)),
    )
    const folder = resolve('.tmp/category-expansion')
    await mkdir(folder, { recursive: true })
    if (!reconcileStockOnly)
      await writeFile(
        resolve(folder, 'publication-dry-run.json'),
        JSON.stringify(
          report.map((p) => ({
            ...p,
            decision: p.firstPublishedAt
              ? 'already-locked'
              : p.earliestAt
                ? 'evidence'
                : p.status === 'unlisted'
                  ? 'conservative-lock'
                  : p.status === 'published'
                    ? 'published-lock'
                    : 'never-published',
          })),
          null,
          2,
        ),
      )
    const drift = await db.$queryRaw<
      Array<{ id: string; stockQuantity: number; actual: bigint }>
    >`SELECT p.id,p."stockQuantity",SUM(v."stockQuantity") AS actual FROM products p JOIN product_variants v ON v."productId"=p.id GROUP BY p.id HAVING p."stockQuantity"<>SUM(v."stockQuantity") ORDER BY p.id`
    await writeFile(
      resolve(folder, reconcileStockOnly ? 'stock-reconcile-dry-run.json' : 'stock-dry-run.json'),
      JSON.stringify(drift, (_, v) => (typeof v === 'bigint' ? Number(v) : v), 2),
    )
    console.log(
      JSON.stringify({
        mode: process.argv.includes('--apply') ? 'apply' : 'dry-run',
        publicationLocks: candidates.length,
        stockDrift: drift.length,
        reconcileStockOnly,
        report: folder,
      }),
    )
    if (!process.argv.includes('--apply')) return
    for (const p of candidates)
      await db.product.updateMany({
        where: { id: p.id, firstPublishedAt: null },
        data: { firstPublishedAt: p.earliestAt ?? new Date() },
      })
    for (const p of drift)
      await db.$transaction(async (tx) => {
        await lockProductStocks(tx, [p.id])
        const total = await tx.productVariant.aggregate({
          where: { productId: p.id },
          _sum: { stockQuantity: true },
        })
        await tx.product.update({
          where: { id: p.id },
          data: { stockQuantity: total._sum.stockQuantity ?? 0 },
        })
      })
    if (!installed)
      await db.catalogInstallation.create({ data: { id: 'publication-stock-backfill-v1' } })
  } finally {
    await db.$disconnect()
  }
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Backfill failed')
  process.exitCode = 1
})
