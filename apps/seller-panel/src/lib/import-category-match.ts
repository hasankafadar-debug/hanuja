export interface ImportCategoryOption {
  id: string
  name: string
  slug: string
}

const TURKISH_CHAR_MAP: Record<string, string> = {
  ç: 'c',
  Ç: 'c',
  ğ: 'g',
  Ğ: 'g',
  ı: 'i',
  I: 'i',
  İ: 'i',
  ö: 'o',
  Ö: 'o',
  ş: 's',
  Ş: 's',
  ü: 'u',
  Ü: 'u',
}

function normalizeCategoryText(value: string) {
  return value
    .trim()
    .replace(/[çÇğĞıIİöÖşŞüÜ]/g, (character) => TURKISH_CHAR_MAP[character] ?? character)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function uniqueMatch(matches: ImportCategoryOption[]) {
  const unique = new Map(matches.map((category) => [category.id, category]))
  return unique.size === 1 ? [...unique.values()][0]?.id ?? '' : ''
}

function leafName(name: string) {
  const parts = name.split('/').map((part) => part.trim()).filter(Boolean)
  return parts.at(-1) ?? name
}

function tokenSet(value: string) {
  return new Set(normalizeCategoryText(value).split(' ').filter(Boolean))
}

function hasSameTokens(left: string, right: string) {
  const leftTokens = tokenSet(left)
  const rightTokens = tokenSet(right)
  if (leftTokens.size === 0 || leftTokens.size !== rightTokens.size) return false
  return [...leftTokens].every((token) => rightTokens.has(token))
}

export function findSuggestedCategoryId(
  suggestedName: string | undefined,
  categories: ImportCategoryOption[],
): string {
  const normalizedSuggestion = suggestedName ? normalizeCategoryText(suggestedName) : ''
  if (!normalizedSuggestion) return ''

  const exactPath = uniqueMatch(
    categories.filter((category) => normalizeCategoryText(category.name) === normalizedSuggestion),
  )
  if (exactPath) return exactPath

  const exactLeaf = uniqueMatch(
    categories.filter((category) => normalizeCategoryText(leafName(category.name)) === normalizedSuggestion),
  )
  if (exactLeaf) return exactLeaf

  const tokenMatch = uniqueMatch(
    categories.filter(
      (category) =>
        hasSameTokens(category.name, suggestedName ?? '') ||
        hasSameTokens(leafName(category.name), suggestedName ?? ''),
    ),
  )
  if (tokenMatch) return tokenMatch

  return uniqueMatch(
    categories.filter((category) => {
      const normalizedName = normalizeCategoryText(category.name)
      const normalizedLeaf = normalizeCategoryText(leafName(category.name))
      return normalizedName.includes(normalizedSuggestion) || normalizedSuggestion.includes(normalizedLeaf)
    }),
  )
}
