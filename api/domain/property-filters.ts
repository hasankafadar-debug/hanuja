import {
  propertyLabel,
  type ProductProperties,
  type ResolvedCategorySchema,
  type PropertyValue,
  type CatalogFieldDefinition,
} from './category-schema'
export interface PropertyFilter {
  values?: Array<string | number | boolean> | undefined
  min?: number | undefined
  max?: number | undefined
}
export type PropertyFilters = Record<string, PropertyFilter>
export interface PropertyFacet {
  key: string
  label: string
  kind: string
  unit: string | null
  values: Array<{ value: string; label: string; count: number }>
  min?: number | undefined
  max?: number | undefined
}
export interface FilterProduct {
  categoryId: string | null
  stockQuantity: number
  properties?: unknown
  variants?: Array<{ stockQuantity: number; properties?: unknown }>
  attributeValues?: Array<{
    optionId: string
    option?: { type: string; label: string }
  }>
}
export type FilterValues = Record<string, Array<string | number | boolean>>

export function parsePropertyFilters(params: URLSearchParams): PropertyFilters {
  const filters: PropertyFilters = Object.create(null)
  for (const [key, value] of params) {
    const choice = /^f\.([a-z][a-z0-9_]*)$/.exec(key),
      range = /^r\.([a-z][a-z0-9_]*)\.(min|max)$/.exec(key)
    if (choice && value.length <= 5000) {
      const k = choice[1]!
      const filter = filters[k] ?? {}
      let values: Array<string | number | boolean> = [value]
      if (value.startsWith('[')) {
        try {
          const parsed: unknown = JSON.parse(value)
          if (
            Array.isArray(parsed) &&
            parsed.length <= 200 &&
            parsed.every((v) => ['string', 'number', 'boolean'].includes(typeof v))
          )
            values = parsed
        } catch {}
      }
      filter.values = [...(filter.values ?? []), ...values]
      filters[k] = filter
    }
    if (range) {
      const n = Number(value)
      if (Number.isFinite(n)) {
        const k = range[1]!
        filters[k] = { ...filters[k], [range[2]!]: n }
      }
    }
  }
  return filters
}

export function filterValuesForProduct(
  product: FilterProduct,
  schema: ResolvedCategorySchema,
): FilterValues {
  const result: FilterValues = {}
  const productValues = (product.properties ?? {}) as ProductProperties
  const variable =
    schema.config.variantKey === 'net_icerik'
      ? schema.config.contentKeys
      : schema.config.variantKey
        ? [schema.config.variantKey]
        : []
  for (const binding of schema.config.fields) {
    const definition = schema.definitions.find((d) => d.key === binding.key)
    if (!definition || definition.isActive === false) continue
    let values: PropertyValue[]
    if (variable.includes(binding.key)) {
      if (definition.kind === 'text') continue
      values = product.variants?.length
        ? product.variants
            .filter((v) => v.stockQuantity > 0)
            .map((v) => ((v.properties ?? {}) as ProductProperties)[binding.key] ?? null)
        : product.stockQuantity > 0
          ? [productValues[binding.key] ?? null]
          : []
    } else values = [productValues[binding.key] ?? null]
    const defined = values.filter((v): v is string | number | boolean => v !== null && v !== '')
    if (defined.length) result[binding.key] = Array.from(new Set(defined))
  }
  for (const type of ['color', 'material'] as const)
    if (schema.config.shared[type]) {
      const options = (product.attributeValues ?? []).filter((v) => v.option?.type === type)
      if (options.length) result[type] = options.map((v) => v.optionId)
    }
  return result
}

export function matchesPropertyFilters(values: FilterValues, filters: PropertyFilters) {
  return Object.entries(filters).every(([key, filter]) => {
    const available = values[key] ?? []
    const selected = filter.values?.flatMap((v) =>
      key === 'cinsiyet' && ['kadin', 'erkek'].includes(String(v)) ? [v, 'unisex'] : [v],
    )
    return available.some(
      (v) =>
        (!selected?.length || selected.some((s) => String(s) === String(v))) &&
        ((filter.min === undefined && filter.max === undefined) ||
          (typeof v === 'number' &&
            (filter.min === undefined || v >= filter.min) &&
            (filter.max === undefined || v <= filter.max))),
    )
  })
}

export function buildPropertyFacets(
  products: FilterProduct[],
  schemas: Map<string, ResolvedCategorySchema>,
  filters: PropertyFilters = {},
): PropertyFacet[] {
  const fields = new Map<string, CatalogFieldDefinition>()
  const projected = products.map((p) => ({
    product: p,
    values:
      p.categoryId && schemas.has(p.categoryId)
        ? filterValuesForProduct(p, schemas.get(p.categoryId)!)
        : {},
  }))
  for (const product of products) {
    const schema = product.categoryId ? schemas.get(product.categoryId) : null
    if (!schema) continue
    for (const field of schema.definitions) fields.set(field.key, field)
  }
  const facets: PropertyFacet[] = []
  for (const key of new Set([
    ...projected.flatMap((p) => Object.keys(p.values)),
    ...Object.keys(filters),
  ])) {
    const counts = new Map<string, number>(),
      labels = new Map<string, string>()
    // Keep alternative values in this OR group available after a selection.
    const other = Object.fromEntries(
      Object.entries(filters).filter(([filterKey]) => filterKey !== key),
    )
    for (const row of projected) {
      // Retain labels even when another group excludes a selected option.
      if (key === 'color' || key === 'material') {
        for (const attribute of row.product.attributeValues ?? []) {
          if (attribute.option?.type === key) labels.set(attribute.optionId, attribute.option.label)
        }
      }
      if (!matchesPropertyFilters(row.values, other)) continue
      const values = (row.values[key] ?? []).flatMap((v) =>
        key === 'cinsiyet' && v === 'unisex' ? ['kadin', 'erkek', 'unisex'] : [v],
      )
      for (const value of new Set(values)) {
        const id = String(value)
        counts.set(id, (counts.get(id) ?? 0) + 1)
        if (key === 'color' || key === 'material')
          labels.set(
            id,
            row.product.attributeValues?.find((a) => a.optionId === id)?.option?.label ?? id,
          )
      }
    }
    const definition = fields.get(key)
    const isNumber = definition?.kind === 'number'
    const values = [...counts].map(([value, count]) => ({
      value,
      label:
        labels.get(value) ??
        (definition
          ? propertyLabel(
              definition,
              isNumber ? Number(value) : definition.kind === 'boolean' ? value === 'true' : value,
            )
          : value),
      count,
    }))
    for (const selected of filters[key]?.values ?? [])
      if (!values.some((v) => v.value === String(selected)))
        values.push({
          value: String(selected),
          label:
            labels.get(String(selected)) ??
            (definition ? propertyLabel(definition, selected) : String(selected)),
          count: 0,
        })
    if (!values.length) continue
    if (isNumber) values.sort((a, b) => Number(a.value) - Number(b.value))
    else if (definition?.kind === 'size') {
      const order = Array.from(new Set(Object.values(definition.config.subsets ?? {}).flat()))
      values.sort((a, b) => order.indexOf(a.value) - order.indexOf(b.value))
    } else values.sort((a, b) => a.label.localeCompare(b.label, 'tr'))
    const numbers = values.map((v) => Number(v.value)).filter(Number.isFinite)
    const onlyChildren =
      filters.yas_grubu?.values?.length &&
      filters.yas_grubu.values.every((v) => ['cocuk', 'bebek'].includes(String(v)))
    facets.push({
      key,
      label:
        key === 'color'
          ? 'Renk'
          : key === 'material'
            ? 'Materyal'
            : key === 'cinsiyet' && onlyChildren
              ? 'Cinsiyet'
              : (definition?.label ?? key),
      kind:
        isNumber &&
        (counts.size > 12 || filters[key]?.min !== undefined || filters[key]?.max !== undefined)
          ? 'range'
          : 'choices',
      unit: definition?.canonicalUnit ?? null,
      values: values.map((v) =>
        key === 'cinsiyet' && onlyChildren && v.value === 'kadin' ? { ...v, label: 'Kız' } : v,
      ),
      ...(isNumber && numbers.length
        ? { min: Math.min(...numbers), max: Math.max(...numbers) }
        : {}),
    })
  }
  return facets
}

export function meiliPropertyFilter(
  filters: PropertyFilters,
  schemas: Map<string, ResolvedCategorySchema>,
): string[] {
  const fields = new Map(
    [...schemas.values()].flatMap((s) => s.definitions.map((d) => [d.key, d] as const)),
  )
  const variables = new Set(
    [...schemas.values()].flatMap((s) =>
      s.config.variantKey === 'net_icerik'
        ? s.config.contentKeys
        : s.config.variantKey
          ? [s.config.variantKey]
          : [],
    ),
  )
  return Object.entries(filters)
    .map(([key, filter]) => {
      if (!fields.has(key) && !['color', 'material'].includes(key))
        return 'id = "__unknown_property__"'
      const names =
        variables.has(key) && fields.get(key)?.kind !== 'text'
          ? [`properties.${key}`, `${key}_stokta`]
          : [`properties.${key}`]
      const wrap = (expression: (name: string) => string) =>
        `(${names.map(expression).join(' OR ')})`
      const parts: string[] = []
      if (filter.values?.length) {
        let values = filter.values.flatMap((v) =>
          key === 'cinsiyet' && ['kadin', 'erkek'].includes(String(v)) ? [v, 'unisex'] : [v],
        )
        if (fields.get(key)?.kind === 'number')
          values = values.filter(
            (v) =>
              Number.isFinite(Number(v)) &&
              (filter.min === undefined || Number(v) >= filter.min) &&
              (filter.max === undefined || Number(v) <= filter.max),
          )
        if (!values.length) return 'id = "__empty_property_selection__"'
        parts.push(
          wrap(
            (name) =>
              `${name} IN [${values.map((v) => (fields.get(key)?.kind === 'number' ? Number(v) : fields.get(key)?.kind === 'boolean' ? String(v) === 'true' : JSON.stringify(v))).join(',')}]`,
          ),
        )
      }
      if (!filter.values?.length) {
        if (filter.min !== undefined && filter.max !== undefined)
          parts.push(wrap((name) => `${name} ${filter.min} TO ${filter.max}`))
        else if (filter.min !== undefined) parts.push(wrap((name) => `${name} >= ${filter.min}`))
        else if (filter.max !== undefined) parts.push(wrap((name) => `${name} <= ${filter.max}`))
      }
      return parts.join(' AND ')
    })
    .filter(Boolean)
}

export function propertyFacetsFromSearch(
  distribution: Record<string, Record<string, number>>,
  stats: Record<string, { min: number; max: number }>,
  schemas: Map<string, ResolvedCategorySchema>,
  filters: PropertyFilters,
  legacy: Array<{ id: string; label: string; type: string }> = [],
): PropertyFacet[] {
  const fields = new Map(
    [...schemas.values()].flatMap((s) => s.definitions.map((d) => [d.key, d] as const)),
  )
  for (const type of ['color', 'material'])
    fields.set(type, {
      key: type,
      label: type === 'color' ? 'Renk' : 'Materyal',
      kind: 'select',
      canonicalUnit: null,
      config: {
        options: legacy
          .filter((o) => o.type === type)
          .map((o) => ({ id: o.id, label: o.label, isActive: true })),
      },
    })
  const counts = new Map<string, Map<string, number>>(),
    ranges = new Map<string, { min: number; max: number }>()
  for (const [attribute, values] of Object.entries(distribution)) {
    const key = attribute.startsWith('properties.')
      ? attribute.slice(11)
      : attribute.endsWith('_stokta')
        ? attribute.slice(0, -7)
        : null
    if (!key) continue
    const result = counts.get(key) ?? new Map<string, number>()
    for (const [value, count] of Object.entries(values))
      result.set(value, (result.get(value) ?? 0) + count)
    counts.set(key, result)
    if (stats[attribute]) {
      const current = ranges.get(key)
      ranges.set(key, {
        min: Math.min(current?.min ?? Infinity, stats[attribute]!.min),
        max: Math.max(current?.max ?? -Infinity, stats[attribute]!.max),
      })
    }
  }
  const facets: PropertyFacet[] = []
  for (const key of new Set([...counts.keys(), ...Object.keys(filters)])) {
    const definition = fields.get(key)
    if (!definition) continue
    const values = counts.get(key) ?? new Map<string, number>()
    if (key === 'cinsiyet' && values.has('unisex'))
      for (const gender of ['kadin', 'erkek'])
        values.set(gender, (values.get(gender) ?? 0) + values.get('unisex')!)
    for (const selected of filters[key]?.values ?? [])
      if (!values.has(String(selected))) values.set(String(selected), 0)
    if (!values.size && filters[key]?.min === undefined && filters[key]?.max === undefined) continue
    const children =
      filters.yas_grubu?.values?.length &&
      filters.yas_grubu.values.every((v) => ['cocuk', 'bebek'].includes(String(v)))
    const options = [...values].map(([value, count]) => ({
      value,
      count,
      label:
        key === 'cinsiyet' && children && value === 'kadin'
          ? 'Kız'
          : propertyLabel(
              definition,
              definition.kind === 'number'
                ? Number(value)
                : definition.kind === 'boolean'
                  ? value === 'true'
                  : value,
            ),
    }))
    if (definition.kind === 'number') options.sort((a, b) => Number(a.value) - Number(b.value))
    else if (definition.kind === 'size') {
      const order = Array.from(new Set(Object.values(definition.config.subsets ?? {}).flat()))
      options.sort((a, b) => order.indexOf(a.value) - order.indexOf(b.value))
    } else options.sort((a, b) => a.label.localeCompare(b.label, 'tr'))
    const numeric = options.map((o) => Number(o.value)).filter(Number.isFinite)
    const range =
      ranges.get(key) ??
      (definition.kind === 'number' && numeric.length
        ? { min: Math.min(...numeric), max: Math.max(...numeric) }
        : undefined)
    facets.push({
      key,
      label: definition.label,
      kind:
        definition.kind === 'number' &&
        (values.size > 12 || filters[key]?.min !== undefined || filters[key]?.max !== undefined)
          ? 'range'
          : 'choices',
      unit: definition.canonicalUnit,
      values: options,
      ...(range ?? {}),
    })
  }
  return facets
}
