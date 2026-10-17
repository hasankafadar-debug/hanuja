/** Pure product identity helpers, shared by forms, imports and server writes. */
export const MAX_PRODUCT_BRAND_LENGTH = 120
export const MAX_PRODUCT_NAME_LENGTH = 200

export function normalizeProductBrand(value: string): string {
  return value.normalize('NFC').trim().replace(/\s+/g, ' ')
}

export function requireProductBrand(value: unknown): string {
  if (typeof value !== 'string' || !normalizeProductBrand(value))
    throw new Error('Marka zorunludur.')
  const brand = normalizeProductBrand(value)
  if (brand.length > MAX_PRODUCT_BRAND_LENGTH)
    throw new Error('Marka en fazla 120 karakter olabilir.')
  return brand
}

export function stripProductBrandPrefix(name: string, brand?: string | null): string {
  let result = normalizeProductBrand(name)
  const prefix = brand ? normalizeProductBrand(brand) : ''
  if (!prefix) return result
  while (
    result
      .toLocaleLowerCase('tr-TR')
      .replace(/ı/g, 'i')
      .startsWith(prefix.toLocaleLowerCase('tr-TR').replace(/ı/g, 'i'))
  ) {
    const remainder = result.slice(prefix.length)
    if (remainder && !/^[\s:–—-]/u.test(remainder)) break
    result = remainder.replace(/^[\s:–—-]+/u, '')
  }
  return result
}

export function formatBrandedProductName(
  name: string,
  brand: string,
  previousBrand?: string | null,
): string {
  const normalizedBrand = requireProductBrand(brand)
  const candidate = normalizeProductBrand(name)
  const withoutCurrentBrand = stripProductBrandPrefix(candidate, normalizedBrand)
  const withoutPreviousBrand = stripProductBrandPrefix(candidate, previousBrand)
  // Prefer the longer matching prefix when old and new brands overlap.
  const baseName =
    previousBrand &&
    normalizeProductBrand(previousBrand).length > normalizedBrand.length &&
    withoutPreviousBrand !== candidate
      ? withoutPreviousBrand
      : withoutCurrentBrand !== candidate
        ? withoutCurrentBrand
        : withoutPreviousBrand
  if (baseName.length < 3) throw new Error('Ürün adı en az 3 karakter olmalıdır.')
  const result = normalizedBrand + ' ' + baseName
  if (result.length > MAX_PRODUCT_NAME_LENGTH)
    throw new Error('Marka dahil ürün adı en fazla 200 karakter olabilir.')
  return result
}

export function previewBrandedProductName(name: string, brand: string): string {
  try {
    return formatBrandedProductName(name, brand)
  } catch {
    return ''
  }
}
