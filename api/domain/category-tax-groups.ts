type DecimalLike = { toString(): string } | string | number | null

export interface CategoryTaxGroupInput {
  id: string
  name: string
  slug: string
  sortOrder: number
  isActive: boolean
  taxRate: DecimalLike
  parent: {
    id: string
    name: string
    parentId: string | null
  } | null
  children: Array<{ id: string }>
}

export interface CategoryTaxGroup {
  key: string
  name: string
  categoryIds: string[]
  memberPaths: string[]
  memberCount: number
  sortOrder: number
  taxRate: string | null
  hasMixedRates: boolean
}

function normalizeTaxRate(value: DecimalLike) {
  if (value === null || value === undefined) return null
  return value.toString()
}

function normalizeGroupKey(name: string) {
  return name.trim().toLocaleLowerCase('tr-TR')
}

export function buildCategoryTaxGroups(categories: CategoryTaxGroupInput[]): CategoryTaxGroup[] {
  const eligibleCategories = categories.filter(
    (category) =>
      category.isActive &&
      category.parent?.parentId === null &&
      category.children.length > 0,
  )

  const groups = new Map<string, CategoryTaxGroup & { rates: Set<string | null> }>()

  for (const category of eligibleCategories) {
    const key = normalizeGroupKey(category.name)
    const existing = groups.get(key)
    const taxRate = normalizeTaxRate(category.taxRate)

    if (!existing) {
      groups.set(key, {
        key,
        name: category.name.trim(),
        categoryIds: [category.id],
        memberPaths: [`${category.parent?.name ?? '—'} / ${category.name}`],
        memberCount: 1,
        sortOrder: category.sortOrder,
        taxRate,
        hasMixedRates: false,
        rates: new Set([taxRate]),
      })
      continue
    }

    existing.categoryIds.push(category.id)
    existing.memberPaths.push(`${category.parent?.name ?? '—'} / ${category.name}`)
    existing.memberCount += 1
    existing.sortOrder = Math.min(existing.sortOrder, category.sortOrder)
    existing.rates.add(taxRate)
  }

  return [...groups.values()]
    .map(({ rates, ...group }) => ({
      ...group,
      hasMixedRates: rates.size > 1,
      taxRate: rates.size === 1 ? ([...rates][0] ?? null) : null,
      memberPaths: group.memberPaths.sort((left, right) => left.localeCompare(right, 'tr')),
      categoryIds: group.categoryIds,
    }))
    .sort(
      (left, right) =>
        left.sortOrder - right.sortOrder || left.name.localeCompare(right.name, 'tr'),
    )
}
