import type { Prisma, PrismaClient } from '@prisma/client'
import { createHash } from 'node:crypto'
import { ValidationError } from '../lib/errors'
import { normalizeSlug } from '../domain/slug'
import catalog from '../domain/category-catalog.json'
import {
  validateProperties,
  variantPropertyKey,
  type ResolvedCategorySchema,
  type TemplateConfig,
  type CatalogFieldDefinition,
  type ProductProperties,
} from '../domain/category-schema'

type Client = Pick<PrismaClient, 'category' | 'catalogField' | 'catalogTemplate' | 'product'> &
  Partial<Pick<PrismaClient, '$queryRaw' | '$transaction'>>
export function validateVariantDescriptor(name: string | undefined, variantLabel = 'Beden') {
  if (
    name &&
    ['Renk', 'Materyal', 'Beden', variantLabel].some(
      (label) => label.trim().toLocaleLowerCase('tr') === name.trim().toLocaleLowerCase('tr'),
    )
  )
    throw new ValidationError(
      'Renk ve materyal ortak ürün alanlarından, varyant ölçüsü kendi alanından girilmelidir.',
    )
}
export async function lockCatalogSchema(
  db: Partial<Pick<PrismaClient, '$queryRaw' | '$transaction'>>,
) {
  if (db.$queryRaw && !db.$transaction)
    await db.$queryRaw`SELECT pg_advisory_xact_lock_shared(82910214)::text`
}
export async function validateSharedAttributes(
  db: Pick<PrismaClient, 'productAttributeOption'>,
  schema: ResolvedCategorySchema,
  input: {
    colorOptionId?: string | null | undefined
    secondColorOptionId?: string | null | undefined
    materialOptionId?: string | null | undefined
  },
  previousIds: string[] = [],
) {
  for (const [key, type] of [
    ['colorOptionId', 'color'],
    ['secondColorOptionId', 'color'],
    ['materialOptionId', 'material'],
  ] as const) {
    const id = input[key]
    if (!id || previousIds.includes(id)) continue
    if (!schema.config.shared[type])
      throw new ValidationError('Bu şablonda bu ortak özellik kullanılmıyor.')
    const option = await db.productAttributeOption.findUnique({ where: { id } })
    if (
      !option ||
      !option.isActive ||
      option.type !== type ||
      (type === 'material' &&
        schema.config.materialLabels.length &&
        !schema.config.materialLabels.includes(option.label))
    )
      throw new ValidationError('Renk veya materyal seçimi kategori şablonuna uygun değil.')
  }
}
export async function resolveCategorySchema(
  db: Client,
  categoryId: string,
): Promise<ResolvedCategorySchema> {
  // Writers keep the schema stable from validation through commit. Readers
  // outside a transaction do not retain a lock.
  await lockCatalogSchema(db)
  const category = await db.category.findUnique({ where: { id: categoryId } })
  if (!category) throw new ValidationError('Kategori bulunamadı.')
  let current = category,
    code = category.templateCode
  const seen = new Set<string>()
  while (!code && current.parentId) {
    if (seen.has(current.id)) throw new ValidationError('Kategori ağacında döngü bulundu.')
    seen.add(current.id)
    const parent = await db.category.findUnique({ where: { id: current.parentId } })
    if (!parent) break
    current = parent
    code = current.templateCode
  }
  if (!code) throw new ValidationError('Bu kategoriye henüz bir şablon atanmamış.')
  const template = await db.catalogTemplate.findUnique({ where: { code } })
  if (!template) throw new ValidationError('Kategori şablonu bulunamadı.')
  const config = template.config as unknown as TemplateConfig
  const definitions = await db.catalogField.findMany({
    where: { key: { in: config.fields.map((f) => f.key) } },
    orderBy: { key: 'asc' },
  })
  return {
    categoryId,
    categoryName: category.name,
    templateCode: code,
    schemaVersion: template.compatibilityVersion,
    config,
    definitions: definitions as unknown as CatalogFieldDefinition[],
  }
}

export function normalizedProductProperties(
  schema: ResolvedCategorySchema,
  raw: ProductProperties,
  previous: ProductProperties = {},
  creating = true,
  variantKey?: string | null,
  hasVariants = false,
) {
  const allowed = new Set(schema.config.fields.map((f) => f.key))
  const unknown = Object.keys(raw).filter((k) => !allowed.has(k))
  if (unknown.length) throw new ValidationError(`Şablonda olmayan alan: ${unknown.join(', ')}`)
  const excluded = hasVariants
    ? schema.config.variantKey === 'net_icerik'
      ? schema.config.contentKeys
      : variantKey
        ? [variantKey]
        : []
    : []
  if (excluded.some((k) => raw[k] !== undefined && raw[k] !== null && raw[k] !== ''))
    throw new ValidationError('Varyant alanını ürün düzeyinde tekrar girmeyin.')
  const result = validateProperties({
    schema,
    values: { ...previous, ...raw },
    previous,
    creating,
    excludedKeys: excluded,
  })
  for (const key of excluded) delete result.values[key]
  if (result.errors.length) throw new ValidationError(result.errors.join(' '))
  return result.values
}

export function normalizedVariantProperties(
  schema: ResolvedCategorySchema,
  raw: ProductProperties,
  productValues: ProductProperties,
  contentUnit?: string,
  previous: ProductProperties = {},
  creating = true,
) {
  const key = variantPropertyKey(schema, contentUnit)
  if (!key)
    throw new ValidationError(
      schema.config.variantKey === 'net_icerik'
        ? 'Net İçerik Birimi seçin; bütün varyantlarda aynı olmalıdır.'
        : 'Bu şablonda varyant desteklenmiyor.',
    )
  if (
    !creating &&
    schema.config.variantKey === 'net_icerik' &&
    schema.config.contentKeys.some(
      (k) => k !== key && previous[k] !== null && previous[k] !== undefined && previous[k] !== '',
    )
  )
    throw new ValidationError(
      'Kaydedilmiş varyantların Net İçerik Birimi değiştirilemez. Farklı ölçüm türü için ayrı ürün oluşturun.',
    )
  if (Object.keys(raw).some((k) => k !== key))
    throw new ValidationError('Bir üründe yalnız şablonun tek varyant alanı değişebilir.')
  const definition = schema.definitions.find((d) => d.key === key)
  if (!definition) throw new ValidationError('Varyant alanı tanımı bulunamadı.')
  const subset: ResolvedCategorySchema = {
    ...schema,
    config: {
      ...schema.config,
      fields: [
        {
          ...(schema.config.fields.find((f) => f.key === key) ?? { key }),
          required:
            definition.kind !== 'text' ||
            Boolean(schema.config.fields.find((f) => f.key === key)?.required),
        },
      ],
      requiredGroups: [],
    },
  }
  const result = validateProperties({
    schema: subset,
    values: { ...previous, ...raw },
    previous,
    creating,
    age: productValues.yas_grubu,
  })
  if (result.errors.length) throw new ValidationError(result.errors.join(' '))
  return result.values
}

export function categoryChangePreview(
  product: {
    id: string
    categoryId: string | null
    updatedAt: Date
    properties: unknown
    variants?: Array<{ id: string; properties: unknown }>
    attributeValues?: Array<{ optionId: string; option: { type: string; label: string } }>
    dimensionWidth?: unknown
    dimensionLength?: unknown
    dimensionHeight?: unknown
  },
  schema: ResolvedCategorySchema,
  contentUnit?: string,
) {
  const values = product.properties as ProductProperties
  const allowed = new Set(schema.config.fields.map((f) => f.key))
  const removed = Object.entries(values)
    .filter(([key]) => !allowed.has(key))
    .map(([key, value]) => ({ key, value }))
  const variantKeys =
    schema.config.variantKey === 'net_icerik'
      ? contentUnit
        ? [variantPropertyKey(schema, contentUnit)]
        : schema.config.contentKeys
      : [schema.config.variantKey]
  for (const variant of product.variants ?? [])
    for (const [key, value] of Object.entries(variant.properties as ProductProperties))
      if (!variantKeys.includes(key)) removed.push({ key: `Varyant ${variant.id}: ${key}`, value })
  const removedAttributeIds = (product.attributeValues ?? [])
    .filter(({ option }) =>
      option.type === 'color'
        ? !schema.config.shared.color
        : option.type === 'material' &&
          (!schema.config.shared.material ||
            (schema.config.materialLabels.length > 0 &&
              !schema.config.materialLabels.includes(option.label))),
    )
    .map(({ optionId, option }) => {
      removed.push({ key: option.type === 'color' ? 'Renk' : 'Materyal', value: option.label })
      return optionId
    })
  if (!schema.config.shared.dimensions)
    for (const [key, label] of [
      ['dimensionWidth', 'En'],
      ['dimensionLength', 'Boy'],
      ['dimensionHeight', 'Yükseklik'],
    ] as const)
      if (product[key] != null) removed.push({ key: label, value: String(product[key]) })
  const variants = (product.variants ?? [])
    .map((v) => ({ id: v.id, properties: v.properties }))
    .sort((a, b) => a.id.localeCompare(b.id))
  const token = createHash('sha256')
    .update(
      JSON.stringify([
        product.id,
        product.categoryId,
        product.updatedAt.toISOString(),
        schema.categoryId,
        schema.templateCode,
        schema.schemaVersion,
        schema.config,
        schema.definitions,
        contentUnit,
        (product.attributeValues ?? [])
          .map((v) => ({ id: v.optionId, type: v.option.type, label: v.option.label }))
          .sort((a, b) => a.id.localeCompare(b.id)),
        [product.dimensionWidth, product.dimensionLength, product.dimensionHeight].map((v) =>
          v == null ? null : String(v),
        ),
        variants,
        removed,
      ]),
    )
    .digest('hex')
  return { removed, removedAttributeIds, confirmationToken: token }
}

/** Idempotent expansion only: it never renames or removes an existing category. */
export async function installCategoryCatalog(db: PrismaClient) {
  if (await db.catalogInstallation.findUnique({ where: { id: 'category-expansion-v1' } }))
    return { inserted: 0, templates: catalog.templates.length }
  for (const field of catalog.fields)
    await db.catalogField.upsert({
      where: { key: field.key },
      update: {},
      create: { ...field, config: field.config as Prisma.InputJsonValue },
    })
  for (const template of catalog.templates)
    await db.catalogTemplate.upsert({
      where: { code: template.code },
      update: {},
      create: { ...template, config: template.config as Prisma.InputJsonValue },
    })
  for (const label of new Set(catalog.templates.flatMap((t) => t.config.materialLabels)))
    await db.productAttributeOption.upsert({
      where: { type_slug: { type: 'material', slug: normalizeSlug(label) } },
      update: {},
      create: { type: 'material', slug: normalizeSlug(label), label },
    })
  const ids = new Map(
    (await db.category.findMany({ select: { id: true, slug: true } })).map((c) => [c.slug, c.id]),
  )
  let inserted = 0
  const siblingOrder = new Map<string, number>()
  for (const node of catalog.nodes) {
    const scope = node.parentSlug ?? '__root__'
    const sortOrder = siblingOrder.get(scope) ?? (node.parentSlug ? 0 : 2)
    siblingOrder.set(scope, sortOrder + 1)
    if (ids.has(node.slug)) continue
    const parentId = node.parentSlug ? (ids.get(node.parentSlug) ?? null) : null
    if (node.parentSlug && !parentId) throw new Error(`Missing category parent: ${node.parentSlug}`)
    const created = await db.category.create({
      data: {
        name: node.name,
        slug: node.slug,
        parentId,
        templateCode: node.templateCode,
        sortOrder,
      },
    })
    ids.set(created.slug, created.id)
    inserted++
  }
  // Attach schemas to actual legacy branches, including admin-created descendants.
  const legacy = await db.category.findMany({
    where: { templateCode: null },
    include: { parent: true },
  })
  const mapping: Record<string, string> = {
    Mobilya: 'EV-MOBILYA',
    Aydınlatma: 'EV-AYDINLATMA',
    'Ev Bakımı': 'EV-BAKIM',
    'Ev Aksesuarları': 'EV-DEKOR',
    'Mutfak & Sofra': 'EV-MUTFAK',
    'Ev Dekorasyon': 'EV-DEKOR',
    'Ev Tekstili': 'EV-TEKSTIL',
    Aksesuar: 'EV-DEKOR',
  }
  for (const node of legacy)
    if (node.parent && ['ev', 'ofis'].includes(node.parent.slug)) {
      const code = mapping[node.name]
      if (code) await db.category.update({ where: { id: node.id }, data: { templateCode: code } })
    }
  await db.category.updateMany({
    where: { slug: 'ev', templateCode: null },
    data: { templateCode: 'EV-DEKOR' },
  })
  await db.category.updateMany({
    where: { slug: 'ofis', templateCode: null },
    data: { templateCode: 'EV-MOBILYA' },
  })
  await db.catalogInstallation.create({ data: { id: 'category-expansion-v1' } })
  return { inserted, templates: catalog.templates.length }
}

export function categorySlug(parentSlug: string | null, name: string) {
  const base = normalizeSlug(name)
  if (!base || (['mobilya', 'aydinlatma', 'aksesuar'].includes(base) && !parentSlug))
    throw new ValidationError('Bu kategori adresi ayrılmıştır; farklı bir ad kullanın.')
  return parentSlug ? `${parentSlug}-${base}` : base
}

export async function loadCategorySchemas(
  db: Client,
): Promise<Map<string, ResolvedCategorySchema>> {
  const [categories, templates, definitions] = await Promise.all([
    db.category.findMany(),
    db.catalogTemplate.findMany(),
    db.catalogField.findMany(),
  ])
  const categoryMap = new Map(categories.map((c) => [c.id, c])),
    templateMap = new Map(templates.map((t) => [t.code, t]))
  const schemas = new Map<string, ResolvedCategorySchema>()
  for (const category of categories) {
    let current: typeof category | undefined = category
    const seen = new Set<string>()
    while (current && !current.templateCode && current.parentId && !seen.has(current.id)) {
      seen.add(current.id)
      current = categoryMap.get(current.parentId)
    }
    const template = current?.templateCode ? templateMap.get(current.templateCode) : null
    if (!template) continue
    const config = template.config as unknown as TemplateConfig
    schemas.set(category.id, {
      categoryId: category.id,
      categoryName: category.name,
      templateCode: template.code,
      schemaVersion: template.compatibilityVersion,
      config,
      definitions: definitions.filter((d) =>
        config.fields.some((f) => f.key === d.key),
      ) as unknown as CatalogFieldDefinition[],
    })
  }
  return schemas
}
