/**
 * Cart Service - cart management.
 */
import type { PrismaClient } from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/client'
import { calculateIncludedTax, resolveCategoryTaxRate } from '../domain/tax'
import {
  NotFoundError,
  SellerOnVacationError,
  SellerSuspendedError,
  ValidationError,
} from '../lib/errors'
import { createCartRepository } from '../repositories/cart.repository'
import { createPlatformSettingsService } from './platform-settings.service'
import { createDiscountService, type EffectivePriceResult } from './discount.service'
import { createCouponService } from './coupon.service'
import { createProductAnalyticsService } from './product-analytics.service'
import { roundMoney } from '@hanuja/security/money'

interface CartServiceDeps {
  prisma: PrismaClient
}

const MAX_ITEM_QUANTITY = 99

function applyEffectivePricing(
  basePrice: Decimal,
  pricing: EffectivePriceResult | undefined | null,
): Decimal {
  if (!pricing?.discountSource) return basePrice
  const src = pricing.discountSource
  if (src.type === 'PERCENT') {
    return Decimal.max(
      basePrice.mul(new Decimal(100).minus(src.value)).div(100),
      new Decimal(0),
    ).toDecimalPlaces(2)
  }
  return Decimal.max(basePrice.minus(src.value), new Decimal(0)).toDecimalPlaces(2)
}

export function createCartService({ prisma }: CartServiceDeps) {
  const carts = createCartRepository(prisma)
  const platformSettings = createPlatformSettingsService({ prisma })
  const couponService = createCouponService({ prisma })
  const productAnalytics = createProductAnalyticsService({ prisma })

  async function buildCartContext(cart: NonNullable<Awaited<ReturnType<typeof carts.findByUserId>>>) {
    const productIds = [...new Set(cart.items.map((item) => item.productId))]
    const [settings, products, categories] = await Promise.all([
      platformSettings.get(),
      productIds.length > 0
        ? prisma.product.findMany({
            where: { id: { in: productIds } },
            include: {
              seller: { select: { id: true, displayName: true, slug: true } },
              images: {
                orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }],
                take: 1,
              },
              variants: { select: { id: true, name: true, price: true } },
            },
          })
        : Promise.resolve([]),
      prisma.category.findMany({ select: { id: true, parentId: true, taxRate: true } }),
    ])

    const productMap = new Map(products.map((product) => [product.id, product]))
    const categoryMap = new Map(categories.map((category) => [category.id, category]))
    const discounts = createDiscountService({ prisma })
    const effectivePriceMap = await discounts.resolveEffectivePrices(products)

    const taxBreakdownMap = new Map<number, Decimal>()
    const sellerSubtotalMap = new Map<string, Decimal>()
    let subtotal = new Decimal(0)
    let taxAmount = new Decimal(0)

    const enrichedItems = cart.items.map((item) => {
      const product = productMap.get(item.productId)
      const pricing = product ? effectivePriceMap.get(product.id) : null
      const variant = item.variantId && product
        ? product.variants.find((candidate) => candidate.id === item.variantId) ?? null
        : null
      const basePrice = variant?.price ?? product?.price ?? new Decimal(item.unitPrice)
      const effectiveUnitPrice = applyEffectivePricing(basePrice, pricing)
      const lineTotal = effectiveUnitPrice.mul(item.quantity)

      subtotal = subtotal.add(lineTotal)

      if (product?.sellerId) {
        sellerSubtotalMap.set(
          product.sellerId,
          (sellerSubtotalMap.get(product.sellerId) ?? new Decimal(0)).add(lineTotal),
        )
      }

      const rate = resolveCategoryTaxRate(product?.categoryId, categoryMap, settings.defaultTaxRate)
      const lineTax = calculateIncludedTax(lineTotal, rate)
      const ratePercent = Number(rate.mul(100).toFixed(2))
      taxBreakdownMap.set(ratePercent, (taxBreakdownMap.get(ratePercent) ?? new Decimal(0)).add(lineTax))
      taxAmount = taxAmount.add(lineTax)

      return {
        ...item,
        unitPrice: effectiveUnitPrice,
        lineTotal,
        product,
        variant,
      }
    })

    const sellerSubtotals = [...sellerSubtotalMap.entries()].map(([sellerId, amount]) => ({
      sellerId,
      subtotal: Number(roundMoney(amount).toFixed(2)),
    }))

    let couponDiscount = new Decimal(0)
    if (cart.couponCode) {
      try {
        const coupon = await couponService.validateCoupon({
          code: cart.couponCode,
          ...(cart.userId ? { userId: cart.userId } : {}),
          cartTotal: Number(roundMoney(subtotal).toFixed(2)),
          sellerSubtotals,
        })
        couponDiscount = new Decimal(coupon.discountAmount)
      } catch {
        couponDiscount = new Decimal(0)
      }
    }

    return {
      settings,
      enrichedItems,
      subtotal: roundMoney(subtotal),
      couponDiscount: roundMoney(couponDiscount),
      taxAmount: roundMoney(taxAmount),
      taxBreakdown: [...taxBreakdownMap.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([ratePercent, amount]) => ({
          ratePercent,
          taxAmount: roundMoney(amount).toFixed(2),
        })),
    }
  }

  return {
    async getCart(userId: string) {
      const cart = await carts.findByUserId(userId)
      if (!cart) {
        const settings = await platformSettings.get()
        return {
          id: null as string | null,
          items: [] as never[],
          couponCode: null as string | null,
          itemCount: 0,
          subtotal: new Decimal(0),
          taxAmount: new Decimal(0),
          freeShippingThresholdTry: settings.freeShippingThresholdTry,
          flatShippingFeeTry: settings.flatShippingFeeTry,
        }
      }

      const context = await buildCartContext(cart)
      const itemCount = cart.items.reduce((sum, item) => sum + item.quantity, 0)
      const shipping = context.subtotal.gte(context.settings.freeShippingThresholdTry)
        ? new Decimal(0)
        : context.settings.flatShippingFeeTry
      const total = context.subtotal.add(shipping).sub(context.couponDiscount)

      return {
        ...cart,
        items: context.enrichedItems.map((item) => ({
          ...item,
          unitPrice: item.unitPrice,
          product: item.product
            ? {
                name: item.product.name,
                slug: item.product.slug,
                seller: item.product.seller,
                images: item.product.images,
              }
            : null,
          variant: item.variant ? { id: item.variant.id, name: item.variant.name } : null,
        })),
        itemCount,
        subtotal: context.subtotal,
        grossSubtotal: context.subtotal,
        netSubtotal: roundMoney(context.subtotal.sub(context.taxAmount)),
        taxAmount: context.taxAmount,
        taxBreakdown: context.taxBreakdown,
        couponDiscount: context.couponDiscount,
        eftDiscount: roundMoney(context.subtotal.mul(context.settings.eftDiscountRate)),
        shipping,
        total: roundMoney(Decimal.max(total, new Decimal(0))),
        eftDiscountRatePercent: Number(context.settings.eftDiscountRate.mul(100).toFixed(2)),
        freeShippingThresholdTry: context.settings.freeShippingThresholdTry,
        flatShippingFeeTry: context.settings.flatShippingFeeTry,
      }
    },

    async addItem(params: {
      userId: string
      productId: string
      quantity: number
      variantId?: string
    }) {
      if (params.quantity < 1) throw new ValidationError('Miktar en az 1 olmalidir')
      if (params.quantity > MAX_ITEM_QUANTITY) {
        throw new ValidationError(`Miktar en fazla ${MAX_ITEM_QUANTITY} olabilir`)
      }

      const product = await prisma.product.findUnique({
        where: { id: params.productId },
        include: {
          variants: true,
          seller: { select: { status: true, vacationModeEnabled: true } },
        },
      })
      if (!product || product.status !== 'published') {
        throw new NotFoundError('Urun', params.productId)
      }
      if (product.seller.status !== 'active') {
        throw new SellerSuspendedError(product.name)
      }
      if (product.seller.vacationModeEnabled) {
        throw new SellerOnVacationError(product.name)
      }
      if (product.variants.length > 0 && !params.variantId) {
        throw new ValidationError('Lutfen bir varyasyon secin')
      }

      const selectedVariant = params.variantId
        ? product.variants.find((variant) => variant.id === params.variantId)
        : null

      if (params.variantId && !selectedVariant) {
        throw new ValidationError('Secilen varyasyon bulunamadi')
      }

      const availableStock = selectedVariant?.stockQuantity ?? product.stockQuantity
      if (availableStock < 1) {
        throw new ValidationError('Urun stokta bulunmuyor')
      }

      const basePrice = selectedVariant?.price ?? product.price
      const discountSvc = createDiscountService({ prisma })
      const pricing = await discountSvc.resolveEffectivePrice(product, product.sellerId)
      const unitPrice = applyEffectivePricing(basePrice, pricing)

      const cart = await carts.findOrCreate(params.userId)
      const existingItem = (
        cart.items as Array<{ productId: string; variantId: string | null; quantity: number }>
      ).find(
        (item) =>
          item.productId === params.productId &&
          (item.variantId ?? '') === (params.variantId ?? ''),
      )

      if (existingItem) {
        const newQty = existingItem.quantity + params.quantity
        const maxAllowed = Math.min(availableStock, MAX_ITEM_QUANTITY)
        if (newQty > maxAllowed) {
          throw new ValidationError(`Sepette en fazla ${maxAllowed} adet bu urun bulunabilir`)
        }
      }

      const item = await carts.addItem(cart.id, params.productId, params.quantity, params.variantId, unitPrice)

      await productAnalytics.recordProductEvent({
        productId: params.productId,
        userId: params.userId,
        eventType: 'cart_add',
      }).catch((error) => {
        console.error('[analytics] Failed to record cart_add event', error)
      })

      return item
    },

    async updateQuantity(params: { userId: string; itemId: string; quantity: number }) {
      if (params.quantity < 1) throw new ValidationError('Miktar en az 1 olmalidir')
      if (params.quantity > MAX_ITEM_QUANTITY) {
        throw new ValidationError(`Miktar en fazla ${MAX_ITEM_QUANTITY} olabilir`)
      }

      const cart = await carts.findByUserId(params.userId)
      if (!cart) throw new NotFoundError('Sepet')

      return carts.updateItemQuantity(cart.id, params.itemId, params.quantity)
    },

    async removeItem(params: { userId: string; itemId: string }) {
      const cart = await carts.findByUserId(params.userId)
      if (!cart) throw new NotFoundError('Sepet')
      return carts.removeItem(cart.id, params.itemId)
    },

    async clearCart(userId: string) {
      const cart = await carts.findByUserId(userId)
      if (!cart) return
      return carts.clearCart(cart.id)
    },

    async applyCoupon(userId: string, couponCode: string) {
      const cart = await carts.findOrCreate(userId)
      const code = couponCode.trim().toUpperCase()
      if (!code) throw new ValidationError('Gecersiz kupon kodu')
      if (cart.items.length === 0) throw new ValidationError('Kupon uygulamak icin sepetinizde urun olmali')

      const context = await buildCartContext(cart)
      await couponService.validateCoupon({
        code,
        userId,
        cartTotal: Number(context.subtotal.toFixed(2)),
        sellerSubtotals: context.enrichedItems.reduce<Array<{ sellerId: string; subtotal: number }>>(
          (items, item) => {
            if (!item.product?.sellerId) return items
            const existing = items.find((entry) => entry.sellerId === item.product?.sellerId)
            const lineTotal = Number(item.lineTotal.toFixed(2))
            if (existing) {
              existing.subtotal += lineTotal
            } else {
              items.push({ sellerId: item.product.sellerId, subtotal: lineTotal })
            }
            return items
          },
          [],
        ),
      })

      return prisma.cart.update({
        where: { id: cart.id },
        data: { couponCode: code },
      })
    },

    async removeCoupon(userId: string) {
      const cart = await carts.findByUserId(userId)
      if (!cart) return
      return prisma.cart.update({ where: { id: cart.id }, data: { couponCode: null } })
    },
  }
}

export type CartService = ReturnType<typeof createCartService>
