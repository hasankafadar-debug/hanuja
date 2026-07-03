interface CategoryRow {
  id: string
  slug: string
  name: string
  parentId: string | null
}

export interface CategoryOption {
  id: string
  name: string
  slug: string
}

function buildCategoryLabel(
  categoryId: string,
  categoryMap: Map<string, CategoryRow>,
  trail = new Set<string>(),
): string {
  const category = categoryMap.get(categoryId)
  if (!category) return ''
  if (trail.has(categoryId)) return category.name

  const nextTrail = new Set(trail)
  nextTrail.add(categoryId)

  if (!category.parentId) return category.name

  const parentLabel = buildCategoryLabel(category.parentId, categoryMap, nextTrail)
  return parentLabel ? `${parentLabel} / ${category.name}` : category.name
}

export function buildCategoryOptions(categories: CategoryRow[]): CategoryOption[] {
  const categoryMap = new Map(categories.map((category) => [category.id, category]))

  return categories.map((category) => ({
    id: category.id,
    name: buildCategoryLabel(category.id, categoryMap),
    slug: category.slug,
  }))
}
