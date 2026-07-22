export interface BulkCategoryNode {
  id: string
  slug: string
  name: string
  parentId: string | null
  isActive?: boolean | null
}

export interface BulkCategoryReferenceRow {
  rootSlug: string
  rootName: string
  displayPath: string
  canonicalKey: string
  realSlug: string
  pathSlugs: string[]
}

export const BULK_TEMPLATE_AREA_SLUGS = ['ev', 'ofis'] as const

export type BulkTemplateAreaSlug = (typeof BULK_TEMPLATE_AREA_SLUGS)[number]

export interface BulkCategoryOption {
  key: string
  label: string
}

export interface BulkTemplateScopedCategoryOption {
  slug: string
  label: string
}

/**
 * A node of the template *scope* tree. Scope is not the product's category: it
 * only narrows which categories the generated sheet offers, so intermediate
 * categories stay selectable here (picking `Mobilya` yields a template covering
 * every furniture leaf). `id`/`parentId` carry slugs so the value can be sent
 * straight to the template endpoint as `scopeCategorySlug`.
 */
export interface BulkScopeNode {
  id: string
  name: string
  parentId: string | null
}

export interface BulkTemplateAreaOption {
  slug: BulkTemplateAreaSlug
  label: string
  categories: BulkTemplateScopedCategoryOption[]
  scopeNodes: BulkScopeNode[]
}

const CATEGORY_PATH_SEPARATOR = ' > '

function normalizeToken(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[^\w\s/-]/g, '')
    .replace(/[\/\s]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
}

function normalizeDisplayValue(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[^\w\s/-]/g, '')
    .replace(/\s*\/\s*/g, '/')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function buildCategoryPath(
  categoryId: string,
  categoryMap: Map<string, BulkCategoryNode>,
  trail = new Set<string>(),
): BulkCategoryNode[] {
  const category = categoryMap.get(categoryId)
  if (!category || trail.has(categoryId)) return []

  const nextTrail = new Set(trail)
  nextTrail.add(categoryId)

  if (!category.parentId) return [category]

  const parentPath = buildCategoryPath(category.parentId, categoryMap, nextTrail)
  return parentPath.length > 0 ? [...parentPath, category] : [category]
}

export function normalizeRootCategoryValue(value: string) {
  return normalizeToken(value)
}

export function normalizeBulkCategoryPathValue(value: string) {
  return normalizeDisplayValue(value)
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean)
    .join(CATEGORY_PATH_SEPARATOR)
}

export function looksLikeCategorySlug(value: string) {
  return /^[a-z0-9-]+$/i.test(value.trim())
}

export function normalizeCategorySlugValue(value: string) {
  return normalizeToken(value)
}

/**
 * Builds the cascading scope tree for one template area. Unlike the reference
 * rows below, this keeps intermediate categories: a seller scoping to `Mobilya`
 * gets a template covering all of its leaves, which is how multi-category bulk
 * uploads stay possible.
 */
export function buildBulkScopeNodes(
  categories: BulkCategoryNode[],
  areaSlug: string,
): BulkScopeNode[] {
  const categoryMap = new Map(categories.map((category) => [category.id, category]))
  const normalizedArea = normalizeRootCategoryValue(areaSlug)
  const nodes: BulkScopeNode[] = []

  for (const category of categories) {
    if (category.isActive === false || !category.parentId) continue

    const path = buildCategoryPath(category.id, categoryMap)
    const root = path[0]
    if (!root || path.length < 2) continue
    if (normalizeRootCategoryValue(root.slug) !== normalizedArea) continue

    const parent = categoryMap.get(category.parentId)
    nodes.push({
      id: category.slug,
      name: category.name,
      // Direct children of the area root open the first level, so they carry no parent.
      parentId: parent?.parentId ? parent.slug : null,
    })
  }

  return nodes
}

export function buildBulkCategoryReferenceRows(categories: BulkCategoryNode[]): BulkCategoryReferenceRow[] {
  const categoryMap = new Map(categories.map((category) => [category.id, category]))
  // Products may only be attached to leaf categories (api/domain/category-selection.ts),
  // so the bulk template must not offer intermediate ones — otherwise the seller fills in
  // a path the upload will reject.
  const parentsOfActiveCategories = new Set(
    categories
      .filter((category) => category.isActive !== false && category.parentId)
      .map((category) => category.parentId as string),
  )
  const rows: BulkCategoryReferenceRow[] = []

  for (const category of categories) {
    if (category.isActive === false || !category.parentId) continue
    if (parentsOfActiveCategories.has(category.id)) continue

    const path = buildCategoryPath(category.id, categoryMap)
    if (path.length < 2) continue

    const root = path[0]
    if (!root) continue

    const displayPath = path.slice(1).map((item) => item.name).join(' / ')
    if (!displayPath) continue

    rows.push({
      rootSlug: root.slug,
      rootName: root.name,
      displayPath,
      canonicalKey: normalizeBulkCategoryPathValue(displayPath),
      realSlug: category.slug,
      pathSlugs: path.slice(1).map((item) => item.slug),
    })
  }

  return rows.sort((a, b) => {
    const labelCompare = a.displayPath.localeCompare(b.displayPath, 'tr')
    if (labelCompare !== 0) return labelCompare
    return a.rootName.localeCompare(b.rootName, 'tr')
  })
}

export function filterBulkCategoryReferenceRows(
  rows: BulkCategoryReferenceRow[],
  scopeKey?: string,
) {
  const normalizedScope = scopeKey?.trim()
  if (!normalizedScope) return rows

  return rows.filter(
    (row) =>
      row.canonicalKey === normalizedScope ||
      row.canonicalKey.startsWith(`${normalizedScope}${CATEGORY_PATH_SEPARATOR}`),
  )
}

export function filterBulkCategoryReferenceRowsByScope(
  rows: BulkCategoryReferenceRow[],
  rootSlug: string,
  scopeCategorySlug?: string,
) {
  const normalizedRoot = normalizeRootCategoryValue(rootSlug)
  const normalizedScope = scopeCategorySlug ? normalizeCategorySlugValue(scopeCategorySlug) : ''

  return rows.filter(
    (row) =>
      normalizeRootCategoryValue(row.rootSlug) === normalizedRoot &&
      (!normalizedScope || row.pathSlugs.includes(normalizedScope)),
  )
}

export function findBulkCategoryReferenceRowBySlug(
  rows: BulkCategoryReferenceRow[],
  slug: string,
) {
  const normalizedSlug = normalizeCategorySlugValue(slug)
  return rows.find((row) => normalizeCategorySlugValue(row.realSlug) === normalizedSlug) ?? null
}

export function buildBulkTemplateCategoryOptions(
  categories: BulkCategoryNode[],
): BulkCategoryOption[] {
  const options = new Map<string, string>()

  for (const row of buildBulkCategoryReferenceRows(categories)) {
    if (!options.has(row.canonicalKey)) {
      options.set(row.canonicalKey, row.displayPath)
    }
  }

  return Array.from(options.entries())
    .map(([key, label]) => ({ key, label }))
    .sort((a, b) => a.label.localeCompare(b.label, 'tr'))
}

export function buildBulkTemplateAreas(
  categories: BulkCategoryNode[],
): BulkTemplateAreaOption[] {
  const roots = new Map(
    categories
      .filter((category) => category.isActive !== false && !category.parentId)
      .map((category) => [normalizeRootCategoryValue(category.slug), category]),
  )
  const referenceRows = buildBulkCategoryReferenceRows(categories)

  return BULK_TEMPLATE_AREA_SLUGS.flatMap((areaSlug) => {
    const root = roots.get(areaSlug)
    if (!root) return []

    const scopedRows = filterBulkCategoryReferenceRowsByScope(referenceRows, areaSlug)
    if (scopedRows.length === 0) return []

    return [
      {
        slug: areaSlug,
        label: root.name,
        categories: scopedRows.map((row) => ({
          slug: row.realSlug,
          label: row.displayPath,
        })),
        scopeNodes: buildBulkScopeNodes(categories, areaSlug),
      },
    ]
  })
}

export function resolveBulkCategoryRealSlug(
  rows: BulkCategoryReferenceRow[],
  rootValue: string,
  categoryValue: string,
  scopeCategorySlug?: string,
) {
  const normalizedRoot = normalizeRootCategoryValue(rootValue)
  const normalizedCategory = normalizeBulkCategoryPathValue(categoryValue)
  const normalizedScope = scopeCategorySlug ? normalizeCategorySlugValue(scopeCategorySlug) : ''

  const match = rows.find(
    (row) =>
      normalizeRootCategoryValue(row.rootSlug) === normalizedRoot &&
      row.canonicalKey === normalizedCategory &&
      (!normalizedScope || row.pathSlugs.includes(normalizedScope)),
  )

  return match?.realSlug ?? null
}
