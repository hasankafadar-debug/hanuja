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

export function normalizeTurkishText(value: string): string {
  return value
    .trim()
    .replace(/[çÇğĞıIİöÖşŞüÜ]/g, (character) => TURKISH_CHAR_MAP[character] ?? character)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

export function tokenizeNormalizedText(value: string): string[] {
  return normalizeTurkishText(value)
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter(Boolean)
}

export function normalizedTokenSet(value: string): string {
  return [...new Set(tokenizeNormalizedText(value))].sort().join('|')
}

export function hasMatchingNormalizedTokens(left: string, right: string): boolean {
  return normalizedTokenSet(left) === normalizedTokenSet(right)
}
