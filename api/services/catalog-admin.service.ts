import { Prisma, type PrismaClient } from '@prisma/client'
import { createHash } from 'node:crypto'
import { ConflictError, ValidationError } from '../lib/errors'
import { categorySlug } from './category-schema.service'
import {
  canonicalNumber,
  type TemplateConfig,
  type CatalogFieldDefinition,
} from '../domain/category-schema'

const auditJson = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
const token = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')

export async function markCatalogProductsDirty(db: Pick<PrismaClient, '$executeRaw'>) {
  await db.$executeRaw`INSERT INTO search_index_dirty_products ("productId",revision,"updatedAt") SELECT id,1,CURRENT_TIMESTAMP FROM products ON CONFLICT ("productId") DO UPDATE SET revision=search_index_dirty_products.revision+1,"updatedAt"=CURRENT_TIMESTAMP`
}

export async function templateCategoryIds(db: Pick<PrismaClient, 'category'>, code: string) {
  const categories = await db.category.findMany({
    select: { id: true, parentId: true, templateCode: true },
  })
  const map = new Map(categories.map((c) => [c.id, c]))
  return categories
    .filter((c) => {
      let current: typeof c | undefined = c
      const seen = new Set<string>()
      while (current && !current.templateCode && current.parentId && !seen.has(current.id)) {
        seen.add(current.id)
        current = map.get(current.parentId)
      }
      return current?.templateCode === code
    })
    .map((c) => c.id)
}

export async function saveManagedCategory(
  db: PrismaClient,
  actorId: string,
  input: {
    id?: string | undefined
    name: string
    parentId?: string | null | undefined
    sortOrder?: number | undefined
    templateCode?: string | null | undefined
    confirmationToken?: string | undefined
    preview?: boolean | undefined
  },
) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(82910214)::text`
    const existing = input.id ? await tx.category.findUnique({ where: { id: input.id } }) : null
    if (input.id && !existing) throw new ValidationError('Kategori bulunamadı.')
    const parentId = existing?.parentId ?? input.parentId ?? null
    if (existing && input.parentId !== undefined && input.parentId !== existing.parentId)
      throw new ValidationError('Kategori taşıma desteklenmiyor.')
    const parent = parentId ? await tx.category.findUnique({ where: { id: parentId } }) : null
    if (parentId && !parent) throw new ValidationError('Üst kategori bulunamadı.')
    if (parentId) await tx.$queryRaw`SELECT id FROM categories WHERE id=${parentId} FOR UPDATE`
    if (!existing && parentId && (await tx.product.count({ where: { categoryId: parentId } })) > 0)
      throw new ValidationError('Ürün bağlı kategoriye alt kategori eklenemez.')
    const duplicate = await tx.category.findFirst({
      where: {
        parentId,
        name: { equals: input.name, mode: 'insensitive' },
        ...(existing ? { id: { not: existing.id } } : {}),
      },
    })
    if (duplicate) throw new ConflictError('Aynı üst kategoride bu ad zaten kullanılıyor.')
    if (
      input.templateCode &&
      !(await tx.catalogTemplate.findUnique({ where: { code: input.templateCode } }))
    )
      throw new ValidationError('Şablon bulunamadı.')
    if (!existing && !parentId && !input.templateCode)
      throw new ValidationError('Ana kategori için şablon seçin.')
    const all = await tx.category.findMany({ select: { id: true, parentId: true } })
    const ids = new Set(existing ? [existing.id] : [])
    let grew = true
    while (grew) {
      grew = false
      for (const c of all)
        if (c.parentId && ids.has(c.parentId) && !ids.has(c.id)) {
          ids.add(c.id)
          grew = true
        }
    }
    const affectedProducts =
      existing && input.templateCode !== undefined && input.templateCode !== existing.templateCode
        ? await tx.product.count({ where: { categoryId: { in: [...ids] } } })
        : 0
    const confirmationToken = token(
      [existing?.updatedAt, input, affectedProducts].map((v, i) =>
        i === 1
          ? { name: input.name, templateCode: input.templateCode, sortOrder: input.sortOrder }
          : v,
      ),
    )
    if (input.preview) return { affectedProducts, confirmationToken }
    if (affectedProducts && input.confirmationToken !== confirmationToken)
      throw new ValidationError('Şablon değişikliğinden etkilenen ürünleri önce onaylayın.')
    const data = {
      name: input.name,
      ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      ...(input.templateCode !== undefined ? { templateCode: input.templateCode } : {}),
    }
    const category = existing
      ? await tx.category.update({ where: { id: existing.id }, data })
      : await tx.category.create({
          data: { ...data, parentId, slug: categorySlug(parent?.slug ?? null, input.name) },
        })
    await tx.adminAuditLog.create({
      data: {
        actorId,
        actionType: existing ? 'category_updated' : 'category_created',
        targetType: 'category',
        targetId: category.id,
        previousData: existing ? auditJson(existing) : Prisma.JsonNull,
        newData: auditJson(category),
      },
    })
    await markCatalogProductsDirty(tx)
    return { category }
  })
}

export function incompatibleTemplateChange(previous: TemplateConfig, next: TemplateConfig) {
  return (
    previous.variantKey !== next.variantKey ||
    JSON.stringify(previous.contentKeys) !== JSON.stringify(next.contentKeys) ||
    previous.fields.some((f) => {
      const n = next.fields.find((n) => n.key === f.key)
      return (
        !n ||
        (n.optionIds && (!f.optionIds || f.optionIds.some((id) => !n.optionIds!.includes(id))))
      )
    }) ||
    next.fields.some(
      (f) => f.required && !previous.fields.some((p) => p.key === f.key && p.required),
    ) ||
    next.requiredGroups.some(
      (g) =>
        !previous.requiredGroups.some(
          (p) => p.label === g.label && JSON.stringify(p.keys) === JSON.stringify(g.keys),
        ),
    )
  )
}

export async function saveCatalogTemplate(
  db: PrismaClient,
  actorId: string,
  input: {
    code: string
    label: string
    config: TemplateConfig
    preview?: boolean | undefined
    confirmationToken?: string | undefined
  },
) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(82910214)::text`
    await tx.$queryRaw`SELECT code FROM catalog_templates WHERE code=${input.code} FOR UPDATE`
    const previous = await tx.catalogTemplate.findUnique({ where: { code: input.code } })
    const keys = input.config.fields.map((f) => f.key)
    const definitions = await tx.catalogField.findMany({ where: { key: { in: keys } } })
    for (const binding of input.config.fields) {
      const definition = definitions.find((d) => d.key === binding.key)
      if (
        binding.displayUnit &&
        definition &&
        (!Number.isFinite(
          canonicalNumber(
            definition as unknown as CatalogFieldDefinition,
            `1 ${binding.displayUnit}`,
          ),
        ) ||
          definition.kind !== 'number')
      )
        throw new ValidationError('Gösterim birimi alanın ölçüm türüne uygun olmalıdır.')
    }
    if (
      new Set(keys).size !== keys.length ||
      (await tx.catalogField.count({ where: { key: { in: keys } } })) !== keys.length
    )
      throw new ValidationError('Şablon alanları benzersiz ve tanımlı olmalıdır.')
    if (
      input.config.requiredGroups.some(
        (g) => !g.keys.length || g.keys.some((k) => !keys.includes(k)),
      )
    )
      throw new ValidationError('Grup zorunluluğu şablondaki alanları kullanmalıdır.')
    if (
      input.config.variantKey &&
      input.config.variantKey !== 'net_icerik' &&
      !keys.includes(input.config.variantKey)
    )
      throw new ValidationError('Varyant alanı şablona eklenmelidir.')
    if (
      input.config.variantKey === 'net_icerik' &&
      (!input.config.contentKeys.length ||
        input.config.contentKeys.some(
          (k) =>
            !['hacim_ml', 'net_agirlik_g', 'paket_adedi'].includes(k) ||
            !keys.includes(k) ||
            definitions.find((d) => d.key === k)?.kind !== 'number',
        ))
    )
      throw new ValidationError(
        'Net İçerik, şablondaki ml, g veya adet sayısal alanlarını kullanmalıdır.',
      )
    const incompatible = previous
      ? incompatibleTemplateChange(previous.config as unknown as TemplateConfig, input.config)
      : false
    const ids = await templateCategoryIds(tx, input.code)
    const affectedProducts = await tx.product.count({ where: { categoryId: { in: ids } } })
    const confirmationToken = token([
      previous?.updatedAt,
      input.code,
      input.label,
      input.config,
      affectedProducts,
    ])
    if (input.preview) return { affectedProducts, incompatible, confirmationToken }
    if (affectedProducts && input.confirmationToken !== confirmationToken)
      throw new ValidationError('Etkilenen ürünleri önce onaylayın.')
    const version = (previous?.compatibilityVersion ?? 1) + (incompatible ? 1 : 0)
    const saved = await tx.catalogTemplate.upsert({
      where: { code: input.code },
      create: { code: input.code, label: input.label, config: auditJson(input.config) },
      update: {
        label: input.label,
        config: auditJson(input.config),
        compatibilityVersion: version,
      },
    })
    await tx.adminAuditLog.create({
      data: {
        actorId,
        actionType: 'catalog_schema_changed',
        targetType: 'template',
        targetId: input.code,
        previousData: previous ? auditJson(previous) : Prisma.JsonNull,
        newData: auditJson(saved),
      },
    })
    await markCatalogProductsDirty(tx)
    return { template: saved }
  })
}

export async function saveCatalogField(
  db: PrismaClient,
  actorId: string,
  input: CatalogFieldDefinition & {
    preview?: boolean | undefined
    confirmationToken?: string | undefined
  },
) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(82910214)::text`
    await tx.$queryRaw`SELECT key FROM catalog_fields WHERE key=${input.key} FOR UPDATE`
    const previous = await tx.catalogField.findUnique({ where: { key: input.key } })
    if (
      previous?.everUsed &&
      (previous.canonicalUnit !== input.canonicalUnit ||
        previous.kind !== input.kind ||
        (previous.config as unknown as CatalogFieldDefinition['config']).integer !==
          input.config.integer ||
        (previous.config as unknown as CatalogFieldDefinition['config']).measurement !==
          input.config.measurement)
    )
      throw new ValidationError(
        'Kullanılmış alanın türü, ölçüm türü veya kanonik birimi değiştirilemez.',
      )
    const old = previous?.config as unknown as CatalogFieldDefinition['config'] | undefined
    if (old?.options?.some((o) => !input.config.options?.some((n) => n.id === o.id)))
      throw new ValidationError('Seçenekler silinemez; pasifleştirin.')
    if (
      old?.subsets &&
      Object.entries(old.subsets).some(([key, values]) =>
        values.some((v) => !input.config.subsets?.[key]?.includes(v)),
      )
    )
      throw new ValidationError('Mevcut beden değerleri sözlükten çıkarılamaz.')
    if (
      input.config.options &&
      new Set(input.config.options.map((o) => o.id)).size !== input.config.options.length
    )
      throw new ValidationError('Seçenek kimlikleri benzersiz olmalıdır.')
    const templates = (await tx.catalogTemplate.findMany()).filter((t) =>
      (t.config as unknown as TemplateConfig).fields.some((f) => f.key === input.key),
    )
    if (templates.length && input.isActive === false)
      throw new ValidationError(
        'Alanı pasifleştirmeden önce bağlı şablonlardan çıkarın; ürün değerleri korunur.',
      )
    const incompatible = Boolean(
      previous &&
      (previous.kind !== input.kind ||
        previous.canonicalUnit !== input.canonicalUnit ||
        old?.measurement !== input.config.measurement ||
        old?.integer !== input.config.integer ||
        (previous.isActive && input.isActive === false) ||
        old?.options?.some(
          (o) => o.isActive && !input.config.options?.find((n) => n.id === o.id)?.isActive,
        )),
    )
    const ids = new Set<string>()
    for (const template of templates)
      for (const id of await templateCategoryIds(tx, template.code)) ids.add(id)
    const affectedProducts = await tx.product.count({ where: { categoryId: { in: [...ids] } } })
    const deactivatedIds =
      old?.options
        ?.filter((o) => o.isActive && !input.config.options?.find((n) => n.id === o.id)?.isActive)
        .map((o) => o.id) ?? []
    const optionUsage = deactivatedIds.length
      ? await tx.product.count({
          where: {
            OR: deactivatedIds.flatMap((id) => [
              { properties: { path: [input.key], equals: id } },
              { variants: { some: { properties: { path: [input.key], equals: id } } } },
            ]),
          },
        })
      : 0
    const confirmationToken = token([
      previous?.updatedAt,
      input.key,
      input.label,
      input.kind,
      input.canonicalUnit,
      input.config,
      input.isActive,
      affectedProducts,
      optionUsage,
    ])
    if (input.preview) return { affectedProducts, optionUsage, incompatible, confirmationToken }
    if (affectedProducts && input.confirmationToken !== confirmationToken)
      throw new ValidationError('Alan değişikliğinden etkilenen ürünleri önce onaylayın.')
    const data = {
      label: input.label,
      kind: input.kind,
      canonicalUnit: input.canonicalUnit,
      config: auditJson(input.config),
      isActive: input.isActive ?? true,
    }
    const field = await tx.catalogField.upsert({
      where: { key: input.key },
      create: { key: input.key, ...data },
      update: data,
    })
    if (incompatible && templates.length)
      await tx.catalogTemplate.updateMany({
        where: { code: { in: templates.map((t) => t.code) } },
        data: { compatibilityVersion: { increment: 1 } },
      })
    await tx.adminAuditLog.create({
      data: {
        actorId,
        actionType: 'catalog_schema_changed',
        targetType: 'field',
        targetId: input.key,
        previousData: previous ? auditJson(previous) : Prisma.JsonNull,
        newData: auditJson(field),
      },
    })
    await markCatalogProductsDirty(tx)
    return { field }
  })
}
