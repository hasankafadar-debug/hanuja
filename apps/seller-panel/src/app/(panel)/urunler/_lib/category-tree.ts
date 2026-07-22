/**
 * Pure helpers for rendering a cascading (level-by-level) category picker.
 *
 * The seller panel loads the full active category tree once
 * (`catalogSvc.listAllCategories()`, which already filters `isActive: true`
 * and orders by `[parentId asc, sortOrder asc]`) and cascades through it in
 * the browser instead of round-tripping to the server per level. No new API
 * route is introduced here.
 */

export interface CategoryNode {
  id: string
  name: string
  parentId: string | null
}

/**
 * Groups categories by their parent id, preserving input order. Because the
 * source list is already sorted by `sortOrder` server-side, callers can rely
 * on the returned arrays being in display order without re-sorting.
 */
export function buildChildrenMap(rows: CategoryNode[]): Map<string | null, CategoryNode[]> {
  const map = new Map<string | null, CategoryNode[]>()

  for (const row of rows) {
    const siblings = map.get(row.parentId)
    if (siblings) {
      siblings.push(row)
    } else {
      map.set(row.parentId, [row])
    }
  }

  return map
}

/**
 * Returns the chain of category ids from the root down to `categoryId`
 * (inclusive). Returns an empty array if the id is not present in `rows`.
 * Guards against malformed/circular parent references with a visited set.
 */
export function getAncestorPath(categoryId: string, rows: CategoryNode[]): string[] {
  const categoryMap = new Map(rows.map((row) => [row.id, row]))
  if (!categoryMap.has(categoryId)) return []

  const path: string[] = []
  const visited = new Set<string>()
  let current: string | null = categoryId

  while (current && !visited.has(current)) {
    visited.add(current)
    const node = categoryMap.get(current)
    if (!node) break
    path.unshift(node.id)
    current = node.parentId
  }

  return path
}

/**
 * A category is a leaf (selectable as a product's final category) if no
 * other active category in the list declares it as a parent. Since `rows`
 * is already filtered to active categories server-side, no extra
 * `isActive` check is needed here.
 */
export function isLeafCategory(categoryId: string, rows: CategoryNode[]): boolean {
  return !rows.some((row) => row.parentId === categoryId)
}
