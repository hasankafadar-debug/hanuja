import { Prisma } from '@prisma/client'

/** Every stock writer locks products before variants, in the same order. */
export async function lockProductStocks(
  tx: Pick<Prisma.TransactionClient, '$queryRaw'>,
  ids: string[],
) {
  const sorted = [...new Set(ids)].sort()
  if (!sorted.length) return
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM products WHERE id IN (${Prisma.join(sorted)}) ORDER BY id FOR UPDATE`,
  )
}
