/**
 * Ürünün müşteriye gösterilen "temel nitelik" metinlerinin tek kaynağı.
 *
 * Mağaza ürün sayfası ve sipariş bazlı hukuki belgeler (Mesafeli Satış
 * Sözleşmesi / Ön Bilgilendirme Formu) aynı renk, malzeme ve ölçü metnini
 * buradan üretir; iki yüzey arasında ifade farkı oluşmaması için formatlama
 * sayfalara kopyalanmaz.
 */

import {
  propertyLabel,
  type ProductProperties,
  type ResolvedCategorySchema,
} from './category-schema'

export interface StructuredCharacteristic {
  key: string
  label: string
  value: string
}
export function buildStructuredCharacteristics(
  schema: ResolvedCategorySchema,
  properties: ProductProperties,
  variants: Array<{ properties: ProductProperties }> = [],
  selected?: ProductProperties,
): StructuredCharacteristic[] {
  const rows: StructuredCharacteristic[] = []
  const variable =
    schema.config.variantKey === 'net_icerik'
      ? schema.config.contentKeys
      : schema.config.variantKey
        ? [schema.config.variantKey]
        : []
  for (const field of schema.config.fields) {
    const definition = schema.definitions.find((d) => d.key === field.key)
    if (!definition || definition.isActive === false) continue
    const values =
      variable.includes(field.key) && variants.length
        ? selected
          ? [selected[field.key] ?? null]
          : variants.map((v) => v.properties[field.key] ?? null)
        : [properties[field.key] ?? null]
    const unique = [...new Set(values.filter((v) => v !== null && v !== ''))]
    if (!unique.length) continue
    let value = unique.map((v) => propertyLabel(definition, v, field.displayUnit)).join(' · ')
    if (definition.kind === 'number' && unique.length > 1) {
      const sorted = unique.map(Number).sort((a, b) => a - b)
      const low = propertyLabel(definition, sorted[0]!, field.displayUnit),
        high = propertyLabel(definition, sorted[sorted.length - 1]!, field.displayUnit)
      const unit = field.displayUnit ?? definition.canonicalUnit
      value =
        unit && unit !== '—'
          ? `${low.replace(new RegExp(` ${unit}$`), '')}–${high}`
          : `${low}–${high}`
    }
    rows.push({ key: field.key, label: definition.label, value })
  }
  return rows
}

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
  const label = (attributeValues ?? [])
    .find((attribute) => attribute.option?.type === 'material')
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
