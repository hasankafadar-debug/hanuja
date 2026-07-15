import type { Prisma } from '@prisma/client'

/**
 * PostgreSQL is the source of truth for storefront visibility.
 * Search indexes and caches may lag, so every customer-facing database query
 * must include both sides of this predicate.
 */
export const PUBLIC_PRODUCT_WHERE = {
  status: 'published',
  seller: { is: { status: 'active' } },
} satisfies Prisma.ProductWhereInput

export function buildPublicProductWhere(
  extra: Prisma.ProductWhereInput = {},
): Prisma.ProductWhereInput {
  return { AND: [PUBLIC_PRODUCT_WHERE, extra] }
}
