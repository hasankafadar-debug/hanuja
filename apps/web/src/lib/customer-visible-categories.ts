import { cache } from 'react'
import { createCatalogService } from '@hanuja/api/services/catalog.service'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'

/**
 * Customer-visible categories (subtree contains >=1 published product),
 * deduped per request so nav, footer, page body and generateMetadata share
 * a single query. Seller/admin surfaces must keep using listAllCategories.
 */
export const getCustomerVisibleCategories = cache(async () => {
  const svc = createCatalogService({ prisma: createPrismaForRoute() })
  return svc.listCustomerVisibleCategories()
})
