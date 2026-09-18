/**
 * Ürünün müşteriye gösterilen "temel nitelik" metinlerinin tek kaynağı.
 *
 * Mağaza ürün sayfası ve sipariş bazlı hukuki belgeler (Mesafeli Satış
 * Sözleşmesi / Ön Bilgilendirme Formu) aynı renk, malzeme ve ölçü metnini
 * buradan üretir; iki yüzey arasında ifade farkı oluşmaması için formatlama
 * sayfalara kopyalanmaz.
 */

export interface ProductAttributeValueLike {
  sortOrder?: number | null
  option?: { type?: string | null; label?: string | null } | null
}

export interface ProductDimensionsCm {
  widthCm: number | null
  lengthCm: number | null
  heightCm: number | null
}

/**
 * Renk etiketleri, Renk 1 (sortOrder 0) → Renk 2 (sortOrder 1) sırasıyla.
 */
export function getProductColorLabels(
  attributeValues: ProductAttributeValueLike[] | null | undefined,
): string[] {
  return (attributeValues ?? [])
    .filter((attribute) => attribute.option?.type === 'color')
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .map((attribute) => attribute.option?.label?.trim() ?? '')
    .filter((label) => label.length > 0)
}

export function getProductMaterialLabel(
  attributeValues: ProductAttributeValueLike[] | null | undefined,
): string | null {
  const label = (attributeValues ?? []).find((attribute) => attribute.option?.type === 'material')
    ?.option?.label?.trim()
  return label && label.length > 0 ? label : null
}

/** "Siyah - Beyaz"; renk yoksa null. */
export function formatProductColors(labels: string[]): string | null {
  return labels.length > 0 ? labels.join(' - ') : null
}

/**
 * "En: 100 cm · Boy: 30 cm · Yükseklik: 45 cm" — yalnız girilen ölçüler;
 * hiçbiri yoksa null (satır render edilmez).
 */
export function formatProductDimensions(dimensions: ProductDimensionsCm): string | null {
  const parts = [
    dimensions.widthCm != null ? `En: ${dimensions.widthCm} cm` : null,
    dimensions.lengthCm != null ? `Boy: ${dimensions.lengthCm} cm` : null,
    dimensions.heightCm != null ? `Yükseklik: ${dimensions.heightCm} cm` : null,
  ].filter((part): part is string => part !== null)
  return parts.length > 0 ? parts.join(' · ') : null
}
