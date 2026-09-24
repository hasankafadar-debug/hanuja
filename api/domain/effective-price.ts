/**
 * Effective (public) price — the single calculation shared by the product page, the cart,
 * checkout and the price history (e-mail plan phase 6).
 *
 * The effective price is KDV-inclusive (stored prices are gross) with the seller's discount
 * rule applied. Personal coupons, shipping and the EFT channel discount are not part of it.
 *
 * Rule resolution: PRODUCT, then CATEGORY, then ALL_PRODUCTS scope; within a scope the rule
 * giving the lowest price on `product.price` wins. The chosen rule is then applied to the
 * variant's own base price (`variant.price ?? product.price`) — exactly what the cart charges.
 */
import type { DiscountRuleScope, DiscountStatus, DiscountType } from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/client'

export interface DiscountRuleLike {
  id: string
  name: string
  sellerId: string
  scope: DiscountRuleScope
  type: DiscountType
  value: Decimal
  categoryId: string | null
  status: DiscountStatus
  startsAt: Date | null
  endsAt: Date | null
  createdAt: Date
  products: Array<{ productId: string }>
}

export interface PriceAwareProduct {
  id: string
  sellerId: string
  categoryId: string | null
  price: Decimal
  compareAtPrice: Decimal | null
}

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

/** The rule's live status at `now`. Mirrored in SQL by hanuja_discount_rule_live_status(). */
export function deriveRuleStatus(
  rule: { status: DiscountStatus; startsAt: Date | null; endsAt: Date | null },
  now: Date,
): DiscountStatus {
  if (rule.status === 'PAUSED' || rule.status === 'EXPIRED') return rule.status
  if (rule.startsAt && rule.startsAt > now) return 'SCHEDULED'
  if (rule.endsAt && rule.endsAt < now) return 'EXPIRED'
  return 'ACTIVE'
}

export function calculateDiscountedPrice(price: Decimal, rule: { type: DiscountType; value: Decimal }) {
  if (rule.type === 'PERCENT') {
    const discounted = price.mul(new Decimal(100).minus(rule.value)).div(100)
    return Decimal.max(discounted, new Decimal(0)).toDecimalPlaces(2)
  }

  return Decimal.max(price.minus(rule.value), new Decimal(0)).toDecimalPlaces(2)
}

function isRuleApplicable(rule: DiscountRuleLike, product: PriceAwareProduct, now: Date) {
  if (deriveRuleStatus(rule, now) !== 'ACTIVE') return false
  if (rule.scope === 'ALL_PRODUCTS') return true
  if (rule.scope === 'CATEGORY') return Boolean(product.categoryId && rule.categoryId === product.categoryId)
  return rule.products.some((entry) => entry.productId === product.id)
}

/** Rules whose scope covers the product, whatever their live status. */
export function isRuleInScope(rule: DiscountRuleLike, product: Pick<PriceAwareProduct, 'id' | 'sellerId' | 'categoryId'>) {
  if (rule.sellerId !== product.sellerId) return false
  if (rule.scope === 'ALL_PRODUCTS') return true
  if (rule.scope === 'CATEGORY') return Boolean(product.categoryId && rule.categoryId === product.categoryId)
  return rule.products.some((entry) => entry.productId === product.id)
}

function pickBestRuleForScope<T extends DiscountRuleLike>(rules: T[], product: PriceAwareProduct) {
  let bestRule: T | null = null
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

export function resolveRuleForProduct<T extends DiscountRuleLike>(
  product: PriceAwareProduct,
  rules: T[],
  now: Date,
): T | null {
  const applicableRules = rules.filter((rule) => isRuleApplicable(rule, product, now))
  const productRules = applicableRules.filter((rule) => rule.scope === 'PRODUCT')
  const categoryRules = applicableRules.filter((rule) => rule.scope === 'CATEGORY')
  const allProductsRules = applicableRules.filter((rule) => rule.scope === 'ALL_PRODUCTS')

  if (productRules.length > 0) return pickBestRuleForScope(productRules, product)
  if (categoryRules.length > 0) return pickBestRuleForScope(categoryRules, product)
  if (allProductsRules.length > 0) return pickBestRuleForScope(allProductsRules, product)
  return null
}

export function buildEffectivePriceResult(
  product: PriceAwareProduct,
  rule: DiscountRuleLike | null,
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

export function computeEffectivePrice(
  product: PriceAwareProduct,
  rules: DiscountRuleLike[],
  now: Date,
): EffectivePriceResult {
  return buildEffectivePriceResult(product, resolveRuleForProduct(product, rules, now))
}

/**
 * Applies the product's resolved rule to a base price — the variant's own price, or the
 * product price for a product without variants. This is what the cart and checkout charge.
 */
export function applyEffectivePricing(
  basePrice: Decimal,
  pricing: Pick<EffectivePriceResult, 'discountSource'> | undefined | null,
): Decimal {
  if (!pricing?.discountSource) return basePrice
  return calculateDiscountedPrice(basePrice, pricing.discountSource)
}

// ---------------------------------------------------------------------------------------------
// Price keys — the purchasable price points. A product with variants cannot be added to the cart
// without choosing a variant, so each variant is a key; a product without variants is one key.

export interface PriceKeySource {
  priceKey: string
  variantId: string | null
  basePrice: Decimal
  stockQuantity: number
}

export function productPriceKey(productId: string) {
  return `product:${productId}`
}

export function variantPriceKey(variantId: string) {
  return `variant:${variantId}`
}

export function buildPriceKeySources(
  product: { id: string; price: Decimal; stockQuantity: number },
  variants: Array<{ id: string; price: Decimal | null; stockQuantity: number }>,
): PriceKeySource[] {
  if (variants.length === 0) {
    return [
      {
        priceKey: productPriceKey(product.id),
        variantId: null,
        basePrice: product.price,
        stockQuantity: product.stockQuantity,
      },
    ]
  }

  return variants.map((variant) => ({
    priceKey: variantPriceKey(variant.id),
    variantId: variant.id,
    basePrice: variant.price ?? product.price,
    stockQuantity: variant.stockQuantity,
  }))
}

/**
 * Future instants at which a rule's live status can change. `deriveRuleStatus` treats a rule as
 * active at exactly `startsAt` and until exactly `endsAt`, so the price changes at `startsAt`
 * and at `endsAt + 1 ms`.
 */
export function ruleBoundaryInstants(rules: DiscountRuleLike[], after: Date): Date[] {
  const instants = new Set<number>()
  for (const rule of rules) {
    if (rule.status === 'PAUSED' || rule.status === 'EXPIRED') continue
    if (rule.startsAt && rule.startsAt.getTime() > after.getTime()) instants.add(rule.startsAt.getTime())
    if (rule.endsAt) {
      const end = rule.endsAt.getTime() + 1
      if (end > after.getTime()) instants.add(end)
    }
  }
  return [...instants].sort((a, b) => a - b).map((time) => new Date(time))
}
