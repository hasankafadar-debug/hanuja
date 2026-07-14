export interface CategoryVisibilityNode {
  id: string
  parentId: string | null
}

/**
 * Computes the set of category ids that are visible to CUSTOMERS.
 *
 * Business rule (launch policy, 2026-07): a category is customer-visible iff
 * it or ANY descendant has at least one published product. Roll-up is upward
 * only — children of a product-bearing category do not become visible.
 *
 * Seller/admin surfaces must NOT use this — they always see the full active
 * tree (bulk upload, import matching and discount scoping depend on it).
 */
export function computeCustomerVisibleCategoryIds(
  categories: readonly CategoryVisibilityNode[],
  publishedCountByCategoryId: ReadonlyMap<string, number>,
): Set<string> {
  const parentById = new Map<string, string | null>()
  for (const category of categories) {
    parentById.set(category.id, category.parentId)
  }

  const visibleIds = new Set<string>()

  for (const [categoryId, count] of publishedCountByCategoryId) {
    if (count <= 0) continue
    // Stale counts may reference deleted/unknown categories — ignore them.
    if (!parentById.has(categoryId)) continue

    let currentId: string | null = categoryId
    const walked = new Set<string>()
    while (currentId !== null) {
      if (visibleIds.has(currentId)) break
      // Guard against parentId cycles in corrupted data.
      if (walked.has(currentId)) break
      walked.add(currentId)
      visibleIds.add(currentId)
      currentId = parentById.get(currentId) ?? null
    }
  }

  return visibleIds
}
