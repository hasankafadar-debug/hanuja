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

type DiscountRuleWithProducts = DiscountRule & {
  products: Array<Pick<DiscountRuleProduct, 'productId'>>
}

type PriceAwareProduct = Pick<Product, 'id' | 'sellerId' | 'categoryId' | 'price' | 'compareAtPrice'>

export interface EffectivePriceResult {
  originalPrice: Decimal
  effectivePrice: Decimal
  discountSource: {
    ruleId: string
    ruleName: string
    scope: DiscountRuleScope
    type: DiscountType
    value: Decimal
    /** Kampanya başlangıç referansı: rule.startsAt varsa o, yoksa kural oluşturulma anı (createdAt). */
    effectiveStartsAt: Date
  } | null
}

function deriveRuleStatus(rule: Pick<DiscountRule, 'status' | 'startsAt' | 'endsAt'>, now: Date): DiscountStatus {
  if (rule.status === 'PAUSED' || rule.status === 'EXPIRED') return rule.status
  if (rule.startsAt && rule.startsAt > now) return 'SCHEDULED'
  if (rule.endsAt && rule.endsAt < now) return 'EXPIRED'
  return 'ACTIVE'
}

function calculateDiscountedPrice(price: Decimal, rule: Pick<DiscountRule, 'type' | 'value'>) {
  if (rule.type === 'PERCENT') {
    const discounted = price.mul(new Decimal(100).minus(rule.value)).div(100)
    return Decimal.max(discounted, new Decimal(0)).toDecimalPlaces(2)
  }

  return Decimal.max(price.minus(rule.value), new Decimal(0)).toDecimalPlaces(2)
}

function isRuleApplicable(rule: DiscountRuleWithProducts, product: PriceAwareProduct, now: Date) {
  if (deriveRuleStatus(rule, now) !== 'ACTIVE') return false
  if (rule.scope === 'ALL_PRODUCTS') return true
  if (rule.scope === 'CATEGORY') return Boolean(product.categoryId && rule.categoryId === product.categoryId)
  return rule.products.some((entry) => entry.productId === product.id)
}

function pickBestRuleForScope(
  rules: DiscountRuleWithProducts[],
  product: PriceAwareProduct,
) {
  let bestRule: DiscountRuleWithProducts | null = null
  let bestPrice: Decimal | null = null

  for (const rule of rules) {
    const discountedPrice = calculateDiscountedPrice(product.price, rule)
    if (bestPrice == null || discountedPrice.lt(bestPrice)) {
      bestRule = rule
      bestPrice = discountedPrice
    }
  }

  return bestRule
}

function resolveRuleForProduct(
  product: PriceAwareProduct,
  rules: DiscountRuleWithProducts[],
  now: Date,
) {
  const applicableRules = rules.filter((rule) => isRuleApplicable(rule, product, now))
  const productRules = applicableRules.filter((rule) => rule.scope === 'PRODUCT')
  const categoryRules = applicableRules.filter((rule) => rule.scope === 'CATEGORY')
  const allProductsRules = applicableRules.filter((rule) => rule.scope === 'ALL_PRODUCTS')

  if (productRules.length > 0) return pickBestRuleForScope(productRules, product)
  if (categoryRules.length > 0) return pickBestRuleForScope(categoryRules, product)
  if (allProductsRules.length > 0) return pickBestRuleForScope(allProductsRules, product)
  return null
}

function buildEffectivePriceResult(
  product: PriceAwareProduct,
  rule: DiscountRuleWithProducts | null,
): EffectivePriceResult {
  if (!rule) {
    return {
      originalPrice: product.compareAtPrice ?? product.price,
      effectivePrice: product.price,
      discountSource: null,
    }
  }

  return {
    originalPrice: product.price,
    effectivePrice: calculateDiscountedPrice(product.price, rule),
    discountSource: {
      ruleId: rule.id,
      ruleName: rule.name,
      scope: rule.scope,
      type: rule.type,
      value: rule.value,
      effectiveStartsAt: rule.startsAt ?? rule.createdAt,
    },
  }
}

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

    return prisma.discountRule.create({
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
    })
  }

  async function deleteRule(sellerId: string, id: string) {
    const existing = await prisma.discountRule.findFirst({ where: { id, sellerId } })
    if (!existing) throw new Error('İndirim kuralı bulunamadı.')

    return prisma.discountRule.update({
      where: { id },
      data: { status: 'EXPIRED', endsAt: new Date() },
    })
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
