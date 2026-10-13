/** Shared by forms, Excel, APIs and storefront filters. No server-only imports. */
export type PropertyValue = string | number | boolean | null
export type ProductProperties = Record<string, PropertyValue>
export interface FieldOption {
  id: string
  label: string
  isActive: boolean
}
export interface CatalogFieldDefinition {
  key: string
  label: string
  kind: string
  canonicalUnit: string | null
  config: {
    options?: FieldOption[] | undefined
    subsets?: Record<string, string[]> | undefined
    integer?: boolean | undefined
    measurement?: string | undefined
    inputUnits?: string | undefined
  }
  isActive?: boolean | undefined
}
export interface TemplateField {
  key: string
  required: boolean
  displayUnit?: string | undefined
  optionIds?: string[] | undefined
}
export interface TemplateConfig {
  fields: TemplateField[]
  requiredGroups: Array<{ label: string; keys: string[] }>
  variantKey: string | null
  variantLabel: string | null
  contentKeys: string[]
  shared: { color: boolean; material: boolean; dimensions: boolean }
  materialLabels: string[]
}
export interface ResolvedCategorySchema {
  categoryId: string
  categoryName: string
  templateCode: string
  schemaVersion: number
  config: TemplateConfig
  definitions: CatalogFieldDefinition[]
}

export function allowedSizeValues(schema: ResolvedCategorySchema, age: unknown): string[] {
  const subsets = schema.definitions.find((f) => f.key === 'beden')?.config.subsets ?? {}
  const infant = age === 'bebek',
    child = age === 'cocuk'
  let keys: string[]
  if (schema.templateCode === 'AYK') {
    keys = infant ? ['B9', 'B12'] : child ? ['B8'] : ['B7']
    if (['Terlik', 'Ev Terliği'].includes(schema.categoryName))
      keys.push(...(infant ? [] : child ? ['B3'] : ['B2', 'B3']))
  } else if (schema.templateCode === 'AKS-GIYIM') {
    keys = infant ? ['B12', 'B3'] : child ? ['B13', 'B3'] : ['B1', 'B2', 'B3']
  } else if (schema.categoryName === 'Çorap') {
    keys = infant ? ['B12', 'B3'] : child ? ['B11', 'B3'] : ['B10', 'B2', 'B3']
  } else {
    keys = infant ? ['B12', 'B3'] : child ? ['B13', 'B3'] : ['B1', 'B2', 'B3', 'B4', 'B6']
    if (!infant && !child && schema.templateCode === 'GIY-ALT') keys.push('B5')
    if (
      !infant &&
      !child &&
      ['Sütyen', 'Bralet', 'Spor Sütyeni', 'Büstiyer', 'Korse', 'İç Çamaşırı Takımı'].includes(
        schema.categoryName,
      )
    )
      keys.push('B14')
  }
  return Array.from(new Set(keys.flatMap((k) => subsets[k] ?? [])))
}

export function variantPropertyKey(
  schema: ResolvedCategorySchema,
  contentUnit?: string,
): string | null {
  if (schema.config.variantKey !== 'net_icerik') return schema.config.variantKey
  const key = (
    { ml: 'hacim_ml', g: 'net_agirlik_g', adet: 'paket_adedi' } as Record<string, string>
  )[contentUnit ?? '']
  return key && schema.config.contentKeys.includes(key) ? key : null
}

export function fieldOptions(
  schema: ResolvedCategorySchema,
  field: TemplateField,
  includeInactive = false,
): FieldOption[] {
  const options = schema.definitions.find((d) => d.key === field.key)?.config.options ?? []
  return options.filter(
    (o) => (includeInactive || o.isActive) && (!field.optionIds || field.optionIds.includes(o.id)),
  )
}

export function propertyLabel(
  definition: CatalogFieldDefinition,
  value: PropertyValue,
  displayUnit?: string,
): string {
  if (value === null || value === '') return ''
  if (typeof value === 'boolean') return value ? 'Evet' : 'Hayır'
  if (typeof value === 'number') {
    if (definition.key === 'minimum_yas_ay')
      return value >= 12 && value % 12 === 0 ? `${value / 12}+ Yaş` : `${value}+ Ay`
    const unit = displayUnit ?? definition.canonicalUnit
    const divisor = unit ? canonicalNumber(definition, `1 ${unit}`) : 1
    if (definition.key === 'depolama_gb' && value >= 1000 && (!displayUnit || displayUnit === 'GB'))
      return `${new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 3 }).format(value / 1000)} TB`
    return `${new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 6 }).format(value / divisor)}${unit && unit !== '—' ? ` ${unit}` : ''}`
  }
  return definition.config.options?.find((o) => o.id === value)?.label ?? value
}

export function canonicalNumber(definition: CatalogFieldDefinition, raw: unknown): number {
  if (typeof raw === 'number') return raw
  const text = String(raw).trim().replace(',', '.')
  const match = /^(-?\d+(?:\.\d+)?)\s*([^\d\s]*)$/.exec(text)
  if (!match) return NaN
  const number = Number(match[1]),
    unit = match[2]
  if (!unit || unit === definition.canonicalUnit || unit === '—') return number
  const conversions: Record<string, Record<string, number>> = {
    ml: { L: 1000, l: 1000 },
    g: { kg: 1000 },
    GB: { TB: 1000 },
    saat: { gün: 24 },
    ay: { yıl: 12 },
    cm: { mm: 0.1 },
    W: { kW: 1000 },
  }
  const factor = conversions[definition.canonicalUnit ?? '']?.[unit]
  return factor === undefined ? NaN : number * factor
}

export function validateProperties(params: {
  schema: ResolvedCategorySchema
  values: ProductProperties
  previous?: ProductProperties
  creating: boolean
  excludedKeys?: string[]
  age?: unknown
}): { values: ProductProperties; errors: string[] } {
  const { schema, previous = {}, creating, excludedKeys = [] } = params
  const values: ProductProperties = { ...params.values }
  const errors: string[] = []
  for (const binding of schema.config.fields) {
    if (excludedKeys.includes(binding.key)) continue
    const definition = schema.definitions.find((d) => d.key === binding.key)
    if (!definition) {
      errors.push(`Alan tanımı bulunamadı: ${binding.key}`)
      continue
    }
    let value = values[binding.key]
    const missing = value === undefined || value === null || value === ''
    const previouslyFilled =
      previous[binding.key] !== undefined &&
      previous[binding.key] !== null &&
      previous[binding.key] !== ''
    if (missing) {
      if (binding.required && (creating || previouslyFilled))
        errors.push(`${definition.label} zorunludur.`)
      continue
    }
    if (definition.kind === 'number') {
      value = canonicalNumber(definition, value)
      if (
        !Number.isFinite(value) ||
        (definition.key !== 'konfor_sicakligi_c' && value < 0) ||
        (definition.config.integer && !Number.isInteger(value))
      )
        errors.push(`${definition.label}: geçerli bir sayı girin.`)
    } else if (definition.kind === 'boolean') {
      if (
        typeof value === 'string' &&
        ['evet', 'hayir', 'hayır'].includes(value.toLocaleLowerCase('tr'))
      )
        value = value.toLocaleLowerCase('tr') === 'evet'
      if (typeof value !== 'boolean') errors.push(`${definition.label}: Evet veya Hayır seçin.`)
    } else if (definition.kind === 'size') {
      if (!allowedSizeValues(schema, params.age ?? values.yas_grubu).includes(String(value)))
        errors.push(`Beden yaş grubuna ve şablona uygun değil: ${value}`)
    } else if (definition.kind === 'select') {
      const retained = !creating && previous[binding.key] === value
      const option = (
        retained ? (definition.config.options ?? []) : fieldOptions(schema, binding, true)
      ).find((o) => o.id === value || o.label === value)
      if (!option || (!option.isActive && (creating || previous[binding.key] !== option.id)))
        errors.push(`${definition.label}: geçersiz veya pasif seçenek.`)
      else value = option.id
    } else if (typeof value !== 'string' || value.length > 500)
      errors.push(`${definition.label}: en fazla 500 karakter girin.`)
    values[binding.key] = value ?? null
  }
  for (const group of schema.config.requiredGroups) {
    const keys = group.keys.filter((k) => !excludedKeys.includes(k))
    if (!keys.length) continue
    if (
      !keys.some((k) => values[k] !== null && values[k] !== undefined && values[k] !== '') &&
      (creating ||
        keys.some((k) => previous[k] !== null && previous[k] !== undefined && previous[k] !== ''))
    )
      errors.push(`${group.label}: izin verilen alanlardan en az birini doldurun.`)
  }
  return { values, errors }
}

/** Rebuild sale-facing options after a category change; old axis labels must not survive. */
export function categoryVariantPresentation(
  schema: ResolvedCategorySchema,
  properties: ProductProperties,
  contentUnit?: string,
) {
  const key = variantPropertyKey(schema, contentUnit)
  const field = schema.definitions.find((f) => f.key === key)
  if (!key || !field || properties[key] == null || properties[key] === '')
    return { name: '', options: {} as Record<string, string> }
  const label = `${schema.config.variantLabel ?? field.label}${field.canonicalUnit && field.canonicalUnit !== '—' ? ` (${field.canonicalUnit})` : ''}`
  const value = propertyLabel(field, properties[key] ?? null)
  return { name: `${label}: ${value}`, options: { [label]: value } }
}
