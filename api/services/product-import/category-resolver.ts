const TURKISH_CHAR_MAP: Record<string, string> = {
  ç: 'c', Ç: 'c', ğ: 'g', Ğ: 'g', ı: 'i', I: 'i', İ: 'i',
  ö: 'o', Ö: 'o', ş: 's', Ş: 's', ü: 'u', Ü: 'u',
}

export function normalizeCategorySegment(value: string): string {
  return value
    .trim()
    .replace(/[çÇğĞıIİöÖşŞüÜ]/g, (c) => TURKISH_CHAR_MAP[c] ?? c)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokenSet(value: string): Set<string> {
  return new Set(normalizeCategorySegment(value).split(' ').filter(Boolean))
}

function looseMatch(hipiconName: string, categoryName: string): boolean {
  const h = normalizeCategorySegment(hipiconName)
  const c = normalizeCategorySegment(categoryName)
  if (h === c) return true

  const hTokens = tokenSet(hipiconName)
  const cTokens = tokenSet(categoryName)
  if (hTokens.size > 0 && hTokens.size === cTokens.size && [...hTokens].every((t) => cTokens.has(t))) {
    return true
  }

  // Stem softening: "sehpa" matches "sehpa modelleri" and vice-versa
  if (h.length > 0 && c.length > 0) {
    if (c.startsWith(h) || h.startsWith(c)) return true
  }

  return false
}

export interface CategoryNode {
  id: string
  name: string
  parentId: string | null
}

export type ImportCategoryDecision =
  | { kind: 'matched'; categoryId: string }
  | { kind: 'auto_create_leaf'; parentId: string; leafName: string }
  | { kind: 'rejected'; reason: 'root_missing' | 'too_shallow' | 'too_divergent' | 'empty_path' }

export function resolveImportCategory(args: {
  hipiconPath: string[]
  categories: CategoryNode[]
}): ImportCategoryDecision {
  const path = args.hipiconPath.map((s) => s.trim()).filter(Boolean)
  if (path.length === 0) return { kind: 'rejected', reason: 'empty_path' }

  // Build children map for fast lookup
  const childrenOf = new Map<string | null, CategoryNode[]>()
  for (const cat of args.categories) {
    const key = cat.parentId ?? null
    const existing = childrenOf.get(key) ?? []
    existing.push(cat)
    childrenOf.set(key, existing)
  }

  function findChildLooseMatch(parentId: string | null, name: string): CategoryNode | undefined {
    const children = childrenOf.get(parentId) ?? []
    return children.find((child) => looseMatch(name, child.name))
  }

  let currentParentId: string | null = null
  let matchDepth = 0

  for (const segment of path) {
    const match = findChildLooseMatch(currentParentId, segment)
    if (!match) break
    currentParentId = match.id
    matchDepth += 1
  }

  if (matchDepth === 0) return { kind: 'rejected', reason: 'root_missing' }
  if (matchDepth === 1 && path.length > 1) return { kind: 'rejected', reason: 'too_shallow' }
  if (matchDepth === path.length) {
    // Business rule: a product may only be assigned to a LEAF category
    // (api/domain/category-selection.ts). If the fully-matched category still
    // has active children in our tree, the Hipicon path stopped one (or more)
    // levels above our leaf level — treat it the same as an under-specified
    // path rather than silently attaching the product to a non-leaf category.
    const matchedHasActiveChildren = (childrenOf.get(currentParentId) ?? []).length > 0
    if (matchedHasActiveChildren) return { kind: 'rejected', reason: 'too_shallow' }
    return { kind: 'matched', categoryId: currentParentId! }
  }

  const remaining = path.length - matchDepth
  if (matchDepth >= 2 && remaining === 1) {
    return {
      kind: 'auto_create_leaf',
      parentId: currentParentId!,
      leafName: path[matchDepth]!,
    }
  }

  return { kind: 'rejected', reason: 'too_divergent' }
}
