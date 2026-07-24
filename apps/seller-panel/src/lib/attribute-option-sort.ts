export type SortableAttributeOption = {
  label: string
  type?: 'color' | 'material' | string
  // Küratörlü palet sırası (ProductAttributeOption.sortOrder). Tanımlıysa birincil
  // sıralama anahtarıdır; eşitse/tanımsızsa label + ton mantığına düşülür.
  sortOrder?: number
}

function normalizeForSort(value: string) {
  return value
    .trim()
    .toLocaleLowerCase('tr')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
}

// Raw prefixes are written with correct Turkish spelling and run through the same
// normalizeForSort() pipeline used for compared labels. This guarantees the tone
// prefixes always match the actual normalized output. Turkish-locale lowercasing of
// "Açık" keeps the dotless "ı" character (it is a distinct base letter, not a
// combining diacritic stripped by NFKD) — a literal spelled with the ASCII dotted
// "i" ("acik") would silently never match without being normalized the same way.
const TONE_PREFIXES = ['açık', 'koyu'].map((prefix) => normalizeForSort(prefix))

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
  // Küratörlü sıra birincildir: seed sortOrder = palet index'i. Tanımsız olan sona
  // düşer ve label ile çözülür.
  const aOrder = a.sortOrder ?? Number.MAX_SAFE_INTEGER
  const bOrder = b.sortOrder ?? Number.MAX_SAFE_INTEGER
  if (aOrder !== bOrder) return aOrder - bOrder

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
