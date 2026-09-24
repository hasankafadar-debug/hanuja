import type {
  DiscountRule,
  DiscountRuleProduct,
  DiscountRuleScope,
  DiscountStatus,
  DiscountType,
  PrismaClient,
  Product,
} from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/client'
import {
  buildEffectivePriceResult,
  deriveRuleStatus,
  resolveRuleForProduct,
  type EffectivePriceResult,
} from '../domain/effective-price'
import {
  PRICE_HISTORY_WRITE_TX_OPTIONS,
  productIdsInRuleScope,
  recordPriceChanges,
} from './price-history.service'

type DiscountRuleWithProducts = DiscountRule & {
  products: Array<Pick<DiscountRuleProduct, 'productId'>>
}

type PriceAwareProduct = Pick<Product, 'id' | 'sellerId' | 'categoryId' | 'price' | 'compareAtPrice'>

export type { EffectivePriceResult }

function buildRuleStatus(startsAt: Date | null, endsAt: Date | null, now: Date): DiscountStatus {
  if (startsAt && startsAt > now) return 'SCHEDULED'
  if (endsAt && endsAt < now) return 'EXPIRED'
  return 'ACTIVE'
}

function assertValidDateRange(startsAt?: Date | null, endsAt?: Date | null) {
  if (startsAt && endsAt && startsAt >= endsAt) {
    throw new Error('Indirim baslangic tarihi bitis tarihinden once olmalidir.')
  }
}

export function createDiscountService({ prisma }: { prisma: PrismaClient }) {
  async function resolveEffectivePrice(product: PriceAwareProduct, sellerId: string, now = new Date()) {
    const orConditions: Array<Record<string, unknown>> = [{ scope: 'ALL_PRODUCTS' }]

    if (product.categoryId) {
      orConditions.push({ scope: 'CATEGORY', categoryId: product.categoryId })
    }

    orConditions.push({ scope: 'PRODUCT', products: { some: { productId: product.id } } })

    const rules = await prisma.discountRule.findMany({
      where: {
        sellerId,
        status: { in: ['ACTIVE', 'SCHEDULED', 'PAUSED'] },
        OR: orConditions as never,
      },
      include: {
        products: {
          select: { productId: true },
        },
      },
    }) as DiscountRuleWithProducts[]

    return buildEffectivePriceResult(product, resolveRuleForProduct(product, rules, now))
  }

  async function resolveEffectivePrices(products: PriceAwareProduct[], now = new Date()) {
    if (products.length === 0) return new Map<string, EffectivePriceResult>()

    const sellerIds = Array.from(new Set(products.map((product) => product.sellerId)))
    const categoryIds = Array.from(
      new Set(products.map((product) => product.categoryId).filter((categoryId): categoryId is string => Boolean(categoryId))),
    )
    const productIds = products.map((product) => product.id)

    const rules = (await prisma.discountRule.findMany({
      where: {
        sellerId: { in: sellerIds },
        status: { in: ['ACTIVE', 'SCHEDULED', 'PAUSED'] },
        OR: [
          { scope: 'ALL_PRODUCTS' },
          { scope: 'CATEGORY', categoryId: { in: categoryIds } },
          { scope: 'PRODUCT', products: { some: { productId: { in: productIds } } } },
        ],
      },
      include: {
        products: {
          select: { productId: true },
        },
      },
    })) as DiscountRuleWithProducts[]

    const rulesBySeller = new Map<string, DiscountRuleWithProducts[]>()
    for (const rule of rules) {
      const sellerRules = rulesBySeller.get(rule.sellerId) ?? []
      sellerRules.push(rule)
      rulesBySeller.set(rule.sellerId, sellerRules)
    }

    return new Map(
      products.map((product) => [
        product.id,
        buildEffectivePriceResult(
          product,
          resolveRuleForProduct(product, rulesBySeller.get(product.sellerId) ?? [], now),
        ),
      ]),
    )
  }

  async function createRule(
    sellerId: string,
    input: {
      name: string
      scope: DiscountRuleScope
      type: DiscountType
      value: number
      categoryId?: string | null
      productIds?: string[]
      startsAt?: Date | null
      endsAt?: Date | null
    },
  ) {
    assertValidDateRange(input.startsAt ?? null, input.endsAt ?? null)

    if (input.scope === 'CATEGORY' && !input.categoryId) {
      throw new Error('Kategori kapsamı için kategori seçimi zorunludur.')
    }

    if (input.scope === 'PRODUCT' && (!input.productIds || input.productIds.length === 0)) {
      throw new Error('Ürün kapsamı için en az bir ürün seçilmelidir.')
    }

    if (input.categoryId) {
      const category = await prisma.category.findUnique({ where: { id: input.categoryId } })
      if (!category) throw new Error('Kategori bulunamadı.')
    }

    if (input.productIds?.length) {
      const ownedProducts = await prisma.product.findMany({
        where: { id: { in: input.productIds }, sellerId },
        select: { id: true },
      })

      if (ownedProducts.length !== input.productIds.length) {
        throw new Error('Seçilen ürünlerden bazıları bu satıcıya ait değil.')
      }
    }

    const now = new Date()
    const status = buildRuleStatus(input.startsAt ?? null, input.endsAt ?? null, now)

    const data: Record<string, unknown> = {
      sellerId,
      name: input.name,
      scope: input.scope,
      type: input.type,
      value: new Decimal(input.value),
      categoryId: input.scope === 'CATEGORY' ? input.categoryId ?? null : null,
      status,
      startsAt: input.startsAt ?? null,
      endsAt: input.endsAt ?? null,
    }

    if (input.scope === 'PRODUCT' && input.productIds?.length) {
      data.products = {
        createMany: {
          data: input.productIds.map((productId) => ({ productId })),
          skipDuplicates: true,
        },
      }
    }

    // The rule and the price history of every product it reprices are written together; the
    // rule's future start/end are recorded as predicted boundaries (e-mail plan phase 6).
    return prisma.$transaction(async (tx) => {
      const rule = await tx.discountRule.create({
        data: data as never,
        include: {
          products: {
            select: { productId: true },
          },
          category: {
            select: { id: true, name: true },
          },
        },
      })
      await recordPriceChanges(tx, {
        productIds: await productIdsInRuleScope(tx, {
          sellerId,
          scope: rule.scope,
          categoryId: rule.categoryId,
          productIds: rule.products.map((entry) => entry.productId),
        }),
        ruleIds: [rule.id],
        source: 'discount_rule_write',
      })
      return rule
    }, PRICE_HISTORY_WRITE_TX_OPTIONS)
  }

  async function listRules(
    sellerId: string,
    filters: {
      status?: DiscountStatus
    } = {},
  ) {
    const rules = await prisma.discountRule.findMany({
      where: {
        sellerId,
        ...(filters.status !== undefined ? { status: filters.status } : {}),
      },
      include: {
        category: {
          select: { id: true, name: true },
        },
        products: {
          include: {
            product: {
              select: { id: true, name: true },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    })

    return rules.map((rule) => ({
      ...rule,
      liveStatus: deriveRuleStatus(rule, new Date()),
    }))
  }

  async function getRule(sellerId: string, id: string) {
    return prisma.discountRule.findFirst({
      where: { id, sellerId },
      include: {
        category: {
          select: { id: true, name: true },
        },
        products: {
          include: {
            product: {
              select: { id: true, name: true },
            },
          },
        },
      },
    })
  }

  async function updateRule(
    sellerId: string,
    id: string,
    input: {
      name?: string
      scope?: DiscountRuleScope
      type?: DiscountType
      value?: number
      categoryId?: string | null
      productIds?: string[]
      startsAt?: Date | null
      endsAt?: Date | null
      status?: DiscountStatus
    },
  ) {
    const existing = await prisma.discountRule.findFirst({
      where: { id, sellerId },
      include: { products: true },
    })
    if (!existing) throw new Error('İndirim kuralı bulunamadı.')

    const nextScope = input.scope ?? existing.scope
    const nextCategoryId = input.categoryId ?? existing.categoryId
    const nextStartsAt = input.startsAt === undefined ? existing.startsAt : input.startsAt
    const nextEndsAt = input.endsAt === undefined ? existing.endsAt : input.endsAt
    const computedStatus =
      input.status ?? buildRuleStatus(nextStartsAt ?? null, nextEndsAt ?? null, new Date())

    assertValidDateRange(nextStartsAt ?? null, nextEndsAt ?? null)

    if (nextScope === 'CATEGORY' && !nextCategoryId) {
      throw new Error('Kategori kapsamı için kategori seçimi zorunludur.')
    }

    if (nextScope === 'PRODUCT') {
      const productIds = input.productIds ?? existing.products.map((entry) => entry.productId)
      if (productIds.length === 0) {
        throw new Error('Ürün kapsamı için en az bir ürün seçilmelidir.')
      }

      const ownedProducts = await prisma.product.findMany({
        where: { id: { in: productIds }, sellerId },
        select: { id: true },
      })
      if (ownedProducts.length !== productIds.length) {
        throw new Error('Seçilen ürünlerden bazıları bu satıcıya ait değil.')
      }
    }

    const previousScopeProductIds = await productIdsInRuleScope(prisma, {
      sellerId,
      scope: existing.scope,
      categoryId: existing.categoryId,
      productIds: existing.products.map((entry) => entry.productId),
    })

    return prisma.$transaction(async (tx) => {
      await tx.discountRule.update({
        where: { id },
        data: {
          name: input.name ?? existing.name,
          scope: nextScope,
          type: input.type ?? existing.type,
          value: input.value !== undefined ? new Decimal(input.value) : existing.value,
          categoryId: nextScope === 'CATEGORY' ? nextCategoryId ?? null : null,
          startsAt: nextStartsAt ?? null,
          endsAt: nextEndsAt ?? null,
          status: computedStatus,
        },
      })

      if (nextScope === 'PRODUCT') {
        const productIds = input.productIds ?? existing.products.map((entry) => entry.productId)
        await tx.discountRuleProduct.deleteMany({ where: { discountRuleId: id } })
        await tx.discountRuleProduct.createMany({
          data: productIds.map((productId) => ({ discountRuleId: id, productId })),
          skipDuplicates: true,
        })
      } else {
        await tx.discountRuleProduct.deleteMany({ where: { discountRuleId: id } })
      }

      const nextScopeProductIds = await productIdsInRuleScope(tx, {
        sellerId,
        scope: nextScope,
        categoryId: nextScope === 'CATEGORY' ? nextCategoryId ?? null : null,
        productIds:
          nextScope === 'PRODUCT' ? input.productIds ?? existing.products.map((entry) => entry.productId) : [],
      })
      await recordPriceChanges(tx, {
        productIds: [...previousScopeProductIds, ...nextScopeProductIds],
        ruleIds: [id],
        source: 'discount_rule_write',
      })

      return tx.discountRule.findUnique({
        where: { id },
        include: {
          category: {
            select: { id: true, name: true },
          },
          products: {
            include: {
              product: {
                select: { id: true, name: true },
              },
            },
          },
        },
      })
    }, PRICE_HISTORY_WRITE_TX_OPTIONS)
  }

  async function deleteRule(sellerId: string, id: string) {
    const existing = await prisma.discountRule.findFirst({
      where: { id, sellerId },
      include: { products: { select: { productId: true } } },
    })
    if (!existing) throw new Error('İndirim kuralı bulunamadı.')

    return prisma.$transaction(async (tx) => {
      const rule = await tx.discountRule.update({
        where: { id },
        data: { status: 'EXPIRED', endsAt: new Date() },
      })
      await recordPriceChanges(tx, {
        productIds: await productIdsInRuleScope(tx, {
          sellerId,
          scope: existing.scope,
          categoryId: existing.categoryId,
          productIds: existing.products.map((entry) => entry.productId),
        }),
        ruleIds: [id],
        source: 'discount_rule_write',
      })
      return rule
    }, PRICE_HISTORY_WRITE_TX_OPTIONS)
  }

  return {
    resolveEffectivePrice,
    resolveEffectivePrices,
    createRule,
    listRules,
    getRule,
    updateRule,
    deleteRule,
  }
}
