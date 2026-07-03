export type SortableAttributeOption = {
  label: string
  type?: 'color' | 'material' | string
}

const TONE_PREFIXES = ['acik', 'açık', 'koyu']

function normalizeForSort(value: string) {
  return value
    .trim()
    .toLocaleLowerCase('tr')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
}

function colorSortParts(label: string) {
  const normalized = normalizeForSort(label)
  const toneIndex = TONE_PREFIXES.findIndex((prefix) => normalized.startsWith(`${prefix} `))

  if (toneIndex === -1) {
    return { base: normalized, toneRank: 0 }
  }

  return {
    base: normalized.slice(TONE_PREFIXES[toneIndex]!.length + 1),
    toneRank: toneIndex + 1,
  }
}

export function compareAttributeOptions<T extends SortableAttributeOption>(a: T, b: T) {
  if (a.type === 'color' || b.type === 'color') {
    const aParts = colorSortParts(a.label)
    const bParts = colorSortParts(b.label)
    const baseCompare = aParts.base.localeCompare(bParts.base, 'tr')
    if (baseCompare !== 0) return baseCompare
    if (aParts.toneRank !== bParts.toneRank) return aParts.toneRank - bParts.toneRank
  }

  return a.label.localeCompare(b.label, 'tr')
}

export function sortAttributeOptions<T extends SortableAttributeOption>(options: T[]) {
  return [...options].sort(compareAttributeOptions)
}
