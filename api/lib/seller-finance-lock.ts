import { Prisma } from '@prisma/client'

/** Acquire before reading financial state. Multi-seller transactions lock in ID order. */
export async function lockSellerFinance(
  tx: Pick<Prisma.TransactionClient, '$queryRaw'>,
  sellerIds: string[],
) {
  for (const sellerId of [...new Set(sellerIds)].sort()) {
    // Keep the same key as the ledger append lock. Cast PostgreSQL void for Prisma.
    await tx.$queryRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${sellerId}, 0))::text`,
    )
  }
}
