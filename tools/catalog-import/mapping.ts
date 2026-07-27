import { normalizeText } from './normalize'
import type { CanonicalField, ImportProfile } from './types'

export const REQUIRED_FIELDS: CanonicalField[] = ['modelCode', 'name', 'category', 'price', 'fulfillmentDays', 'stock']

export const HEADER_ALIASES: Record<CanonicalField, string[]> = {
  modelCode: ['model kodu', 'model code', 'urun grup kodu', 'ürün grup kodu'],
  name: ['urun adi', 'ürün adı', 'product name', 'name'],
  category: ['kategori', 'category', 'category path'],
  price: ['fiyat', 'satis fiyati', 'satış fiyatı', 'price'],
  fulfillmentDays: ['sevk suresi', 'sevk süresi', 'sevk suresi is gunu', 'sevk süresi iş günü', 'tedarik suresi', 'tedarik süresi', 'fulfillment days'],
  stock: ['stok', 'stock', 'stok miktari', 'stok miktarı'],
  barcode: ['barkod', 'barcode'], sku: ['sku'],
  description: ['aciklama', 'açıklama', 'description', 'urun aciklamasi', 'ürün açıklaması'],
  shortDescription: ['kisa aciklama', 'kısa açıklama', 'short description'], story: ['urun hikayesi', 'ürün hikayesi', 'hikaye', 'story'],
  careInstructions: ['bakim tavsiyesi', 'bakım tavsiyesi', 'bakim notu', 'bakım notu', 'care instructions'],
  color1: ['renk 1', 'ana renk', 'product color'], color2: ['renk 2', 'ikinci renk', 'second color'], material: ['materyal', 'material'],
  compareAtPrice: ['liste fiyati', 'liste fiyatı', 'compare at price', 'indirim oncesi fiyat', 'indirim öncesi fiyat'],
  weight: ['agirlik', 'ağırlık', 'weight'], dimensionWidth: ['en', 'genislik', 'genişlik', 'width'], dimensionLength: ['boy', 'uzunluk', 'length'], dimensionHeight: ['yukseklik', 'yükseklik', 'height'],
}

export function resolveHeaders(headers: unknown[], profile?: ImportProfile): Partial<Record<CanonicalField, number>> {
  const normalized = headers.map(normalizeText); const result: Partial<Record<CanonicalField, number>> = {}
  for (const field of Object.keys(HEADER_ALIASES) as CanonicalField[]) {
    const override = profile?.headerOverrides?.[field]
    const aliases = (override ? [override] : HEADER_ALIASES[field]).map(normalizeText)
    const matches = normalized.map((header, index) => ({ header, index })).filter(({ header }) => aliases.some((alias) => header === alias || (!override && header.startsWith(`${alias} `))))
    if (matches.length === 1) result[field] = matches[0]!.index
  }
  return result
}

export function findAmbiguousHeaderFields(headers: unknown[], profile?: ImportProfile): CanonicalField[] {
  const normalized = headers.map(normalizeText)
  return (Object.keys(HEADER_ALIASES) as CanonicalField[]).filter((field) => {
    const override = profile?.headerOverrides?.[field]
    const aliases = (override ? [override] : HEADER_ALIASES[field]).map(normalizeText)
    const count = normalized.filter((header) => aliases.some((alias) => header === alias || (!override && header.startsWith(`${alias} `)))).length
    return count > 1
  })
}

function profileImageMatcher(profile?: ImportProfile) {
  const aliases = new Set((profile?.imageHeaderAliases ?? []).map(normalizeText))
  const expression = profile?.imageHeaderRegex ? new RegExp(profile.imageHeaderRegex, 'i') : undefined
  return (header: string) => aliases.has(header) || Boolean(expression?.test(header))
}

export function findImageColumnsForProfile(headers: unknown[], profile?: ImportProfile): number[] {
  const configured = profileImageMatcher(profile)
  return headers.map((value, index) => ({ value: normalizeText(value), index })).filter(({ value }) => /^(gorsel|image|resim)( \d+)?$/.test(value) || configured(value)).map(({ index }) => index)
}

export function categoryMatches(value: string | undefined, profile?: ImportProfile): string[][] | undefined {
  if (!value) return undefined
  const normalized = normalizeText(value)
  const matches = (profile?.categoryRules ?? []).filter((candidate) => normalized.includes(normalizeText(candidate.contains))).map((candidate) => candidate.path)
  return [...new Map(matches.map((item) => [item.map(normalizeText).join('/'), item])).values()]
}

export function mapCategory(value: string | undefined, profile?: ImportProfile): string[] | undefined {
  const matches = categoryMatches(value, profile)
  return matches?.length === 1 ? matches[0] : undefined
}
