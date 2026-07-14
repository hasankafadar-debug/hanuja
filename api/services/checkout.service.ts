/**
 * Checkout Service - sepetten siparişe dönüşüm.
 *
 * GÜVENLİK KURALI: Hiçbir zaman client'tan gelen toplam/fiyat bilgisine güvenme.
 * Tüm tutarlar sunucu tarafında ürün veritabanından yeniden hesaplanır.
 *
 * AKIŞ:
 *   cart -> validate -> create Order (draft) -> create OrderLines
 *   -> create Payment -> checkout_started -> payment_pending
 *   -> ödeme yöntemi eft ise cart clear -> return { order, payment }
 *
 * Gerçek Iyzico çağrısı entegrasyon katmanında yapılır.
 * See: cart-checkout-flow skill, 07-marketplace-finance-rules.md
 */
import type { Prisma, PrismaClient } from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/client'
import {
  allocateCouponDiscount,
  calculateCommission,
  resolveCommissionRate,
} from '../domain/payout-calculator'
import { calculateIncludedTax, resolveCategoryTaxRate } from '../domain/tax'
import { NotFoundError, ValidationError, ConflictError } from '../lib/errors'
import { createCartRepository } from '../repositories/cart.repository'
import { hashLegalDocumentHtml, renderLegalDocuments } from '../lib/legal-documents'
import type { LegalAcceptanceEvidence } from '../lib/legal-acceptance'
import { enqueueNotification } from '../jobs/notification-dispatch.job'
import { getPlatformBankInfo } from '../lib/platform-info'
import { createPlatformBankAccountService } from './platform-bank-account.service'
import { formatOrderNumber, formatOrderDisplayNumber } from '../lib/order-number'
import { createPlatformSettingsService } from './platform-settings.service'
import { createDiscountService, type EffectivePriceResult } from './discount.service'
import { createCouponService } from './coupon.service'
import { roundMoney, formatMoney as baseFormatMoney } from '@hanuja/security/money'
import { assertPaymentMethodEnabled } from '../lib/payment-capabilities'

// Sistem varsayılan komisyon oranı - proje büyüdükçe commission config tablosuna taşınır
// Öncelik sırası (CLAUDE.md 15.1): ürün override > kategori > satıcı genel > sistem default

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

interface CheckoutServiceDeps {
  prisma: PrismaClient
}

type CheckoutPaymentMethod = 'card' | 'eft'

type DraftSeller = Prisma.SellerGetPayload<{
  include: { profile: true }
}>

type CheckoutDraft = {
  cart: {
    id: string
    couponCode: string | null
    items: Array<{
      productId: string
      variantId: string | null
      quantity: number
    }>
  }
  address: Prisma.AddressGetPayload<Record<string, never>>
  customer: Prisma.UserGetPayload<Record<string, never>>
  lines: Array<{
    productId: string
    sellerId: string
    variantId: string | null
    productName: string
    variantName: string | null
    quantity: number
    unitPrice: Decimal
    totalPrice: Decimal
    taxRate: Decimal
    taxAmount: Decimal
    couponDiscountAmount: Decimal
    commissionRate: Decimal
    commissionAmount: Decimal
    netPayoutAmount: Decimal
    promisedFulfillmentDays: number
  }>
  grossAmount: Decimal
  netSubtotal: Decimal
  shippingAmount: Decimal
  discountAmount: Decimal
  couponId: string | null
  eftDiscountAmount: Decimal
  eftDiscountRate: Decimal
  taxAmount: Decimal
  taxBreakdown: Array<{ ratePercent: number; taxAmount: string }>
  totalAmount: Decimal
  legalContext: Parameters<typeof renderLegalDocuments>[0]
}

function formatAddress(address: {
  addressLine1: string
  addressLine2: string | null
  district: string
  city: string
  postalCode: string
}) {
  const postalCode = address.postalCode.trim()
  return [
    address.addressLine1.trim(),
    address.addressLine2?.trim() || null,
    [address.district.trim(), '/', address.city.trim(), postalCode].filter(Boolean).join(' '),
  ]
    .filter(Boolean)
    .join(', ')
}

function decimalToNumber(value: Decimal) {
  return Number(value.toFixed(2))
}

function formatMoney(value: Decimal | number | string) {
  return baseFormatMoney(value instanceof Decimal ? decimalToNumber(value) : value)
}

function fallbackText(value: string | null | undefined, placeholder: string) {
  const normalized = value?.trim()
  return normalized && normalized.length > 0 ? normalized : placeholder
}

function buildSellerSnapshot(seller: DraftSeller) {
  return {
    sellerId: seller.id,
    storeName: fallbackText(seller.displayName, 'Satıcı Mağazası'),
    companyName: fallbackText(seller.profile?.companyName, seller.displayName),
    legalAddress: fallbackText(
      seller.profile?.legalAddress,
      'Satıcı açık adres bilgisi panelde güncellenecektir.',
    ),
    district: fallbackText(seller.profile?.district, '-'),
    city: fallbackText(seller.profile?.city, '-'),
    postalCode: fallbackText(seller.profile?.postalCode, '-'),
    taxOffice: fallbackText(seller.profile?.taxOffice, '-'),
    taxNumber: fallbackText(seller.profile?.taxNumber, '-'),
    mersis: fallbackText(seller.profile?.mersis, '-'),
    phone: fallbackText(seller.profile?.phone, '-'),
  }
}

export function createCheckoutService({ prisma }: CheckoutServiceDeps) {
  const carts = createCartRepository(prisma)
  const platformSettings = createPlatformSettingsService({ prisma })
  const couponService = createCouponService({ prisma })

  async function buildCheckoutDraft(params: {
    userId: string
    addressId: string
    billingAddressId?: string
    paymentMethod: CheckoutPaymentMethod
  }): Promise<CheckoutDraft> {
    assertPaymentMethodEnabled(params.paymentMethod)

    const cart = await carts.findByUserId(params.userId)
    if (!cart || cart.items.length === 0) {
      throw new ValidationError('Sepet boş veya bulunamadı')
    }

    const [address, customer, settings] = await Promise.all([
      prisma.address.findFirst({
        where: { id: params.addressId, userId: params.userId },
      }),
      prisma.user.findUnique({ where: { id: params.userId } }),
      platformSettings.get(),
    ])

    if (!address) throw new NotFoundError('Adres', params.addressId)
    if (!customer) throw new NotFoundError('Kullanıcı', params.userId)
    const billingAddress = params.billingAddressId && params.billingAddressId !== address.id
      ? await prisma.address.findFirst({ where: { id: params.billingAddressId, userId: params.userId } })
      : address
    if (!billingAddress) throw new NotFoundError('Fatura adresi', params.billingAddressId)

    const productIds = cart.items.map((item) => item.productId)
    const [products, categories] = await Promise.all([
      prisma.product.findMany({
        where: { id: { in: productIds }, status: 'published' },
        include: {
          seller: { include: { profile: true } },
          variants: true,
        },
      }),
      prisma.category.findMany({ select: { id: true, parentId: true, taxRate: true } }),
    ])
    const categoryMap = new Map(categories.map((category) => [category.id, category]))

    const discountSvc = createDiscountService({ prisma })
    const effectivePriceMap = await discountSvc.resolveEffectivePrices(products)

    // Faz 1: satır fiyat/vergi snapshot'ları — kupon payı ve komisyon henüz
    // hesaplanmaz (kupon dağıtımı yalnız satıcı kuponunda gerekir ve subtotal'lar
    // gerektirir; komisyon tabanı kupon payı düşüldükten sonra belirlenir).
    type RawLine = {
      productId: string
      sellerId: string
      variantId: string | null
      productName: string
      variantName: string | null
      quantity: number
      unitPrice: Decimal
      totalPrice: Decimal
      taxRate: Decimal
      taxAmount: Decimal
      commissionRate: Decimal
      promisedFulfillmentDays: number
    }
    const rawLines: RawLine[] = []
    const sellerMap = new Map<string, ReturnType<typeof buildSellerSnapshot>>()

    for (const item of cart.items as Array<{
      productId: string
      variantId: string | null
      quantity: number
    }>) {
      const product = products.find((entry) => entry.id === item.productId)
      if (!product) {
        throw new ConflictError(
          'Sepetteki bir ürün artık satışta değil. Lütfen sepeti güncelleyin.',
        )
      }

      const variant = item.variantId
        ? product.variants.find((entry) => entry.id === item.variantId)
        : null

      if (product.variants.length > 0 && !variant) {
        throw new ConflictError(
          `"${product.name}" için varyasyon seçimi geçersiz. Lütfen sepeti güncelleyin.`,
        )
      }

      const availableStock = variant?.stockQuantity ?? product.stockQuantity
      if (availableStock < item.quantity) {
        throw new ConflictError(
          `"${product.name}" için yeterli stok yok (kalan: ${availableStock})`,
        )
      }

      const basePrice = variant?.price ?? product.price
      const unitPrice = applyEffectivePricing(basePrice, effectivePriceMap.get(product.id))
      const totalPrice = unitPrice.mul(item.quantity)
      const taxRate = resolveCategoryTaxRate(product.categoryId, categoryMap, settings.defaultTaxRate)
      const taxAmount = calculateIncludedTax(totalPrice, taxRate)
      const commissionRate = resolveCommissionRate(
        null,
        null,
        product.seller.commissionRateOverride,
        settings.defaultSellerCommissionRate,
      )

      if (!sellerMap.has(product.sellerId)) {
        sellerMap.set(product.sellerId, buildSellerSnapshot(product.seller))
      }

      rawLines.push({
        productId: product.id,
        sellerId: product.sellerId,
        variantId: item.variantId,
        productName: product.name,
        variantName: variant?.name ?? null,
        quantity: item.quantity,
        unitPrice,
        totalPrice,
        taxRate,
        taxAmount,
        commissionRate,
        promisedFulfillmentDays: product.fulfillmentDays ?? settings.fulfillmentDays,
      })
    }

      const grossAmount = rawLines.reduce((sum, line) => sum.add(line.totalPrice), new Decimal(0))
      const sellerSubtotals = [...rawLines.reduce((map, line) => {
        map.set(line.sellerId, (map.get(line.sellerId) ?? new Decimal(0)).add(line.totalPrice))
        return map
      }, new Map<string, Decimal>()).entries()].map(([sellerId, subtotal]) => ({
        sellerId,
        subtotal: Number(roundMoney(subtotal).toFixed(2)),
      }))
      const shippingAmount = grossAmount.gte(settings.freeShippingThresholdTry)
        ? new Decimal(0)
        : settings.flatShippingFeeTry
      const couponCode = cart.couponCode?.trim() || null
      const couponValidation = couponCode
        ? await couponService.validateCoupon({
            code: couponCode,
            userId: params.userId,
            cartTotal: Number(roundMoney(grossAmount).toFixed(2)),
            sellerSubtotals,
          })
        : null
      const discountAmount = new Decimal(couponValidation?.discountAmount ?? 0)
      const couponId = couponValidation?.couponId ?? null

      // Faz 2: satıcı-scope'lu kupon indirimini o satıcının satırlarına dağıt.
      // Platform kuponunda (couponValidation.sellerId null) satırlar etkilenmez —
      // indirim maliyeti platform tarafından emilir (mevcut EFT indirimi felsefesi).
      const couponSellerId = couponValidation?.sellerId ?? null
      const couponShareByLineIndex: Decimal[] = rawLines.map(() => new Decimal(0))
      if (couponSellerId && discountAmount.gt(0)) {
        const sellerLineIndices = rawLines
          .map((line, index) => ({ line, index }))
          .filter(({ line }) => line.sellerId === couponSellerId)
        const shares = allocateCouponDiscount(
          sellerLineIndices.map(({ line }) => ({ totalPrice: line.totalPrice })),
          discountAmount,
        )
        sellerLineIndices.forEach(({ index }, i) => {
          couponShareByLineIndex[index] = shares[i] ?? new Decimal(0)
        })
      }

      // Faz 3: kupon payı düşüldükten sonra KDV dahil komisyon + net hakediş.
      const lines: CheckoutDraft['lines'] = rawLines.map((line, index) => {
        const couponDiscountAmount = couponShareByLineIndex[index] ?? new Decimal(0)
        const commissionBase = roundMoney(line.totalPrice.sub(couponDiscountAmount))
        const commissionAmount = calculateCommission(
          commissionBase,
          line.commissionRate,
          settings.commissionVatRate,
        )
        const netPayoutAmount = roundMoney(
          line.totalPrice.sub(couponDiscountAmount).sub(commissionAmount),
        )
        return {
          productId: line.productId,
          sellerId: line.sellerId,
          variantId: line.variantId,
          productName: line.productName,
          variantName: line.variantName,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          totalPrice: line.totalPrice,
          taxRate: line.taxRate,
          taxAmount: line.taxAmount,
          couponDiscountAmount,
          commissionRate: line.commissionRate,
          commissionAmount,
          netPayoutAmount,
          promisedFulfillmentDays: line.promisedFulfillmentDays,
        }
      })

      const taxAmount = lines.reduce((sum, line) => sum.add(line.taxAmount), new Decimal(0))
      const netSubtotal = grossAmount.sub(taxAmount)
      const eftDiscountRate = params.paymentMethod === 'eft' ? settings.eftDiscountRate : new Decimal(0)
      const eftDiscountAmount = eftDiscountRate.gt(0)
        ? roundMoney(grossAmount.mul(eftDiscountRate))
        : new Decimal(0)
      const taxBreakdownMap = new Map<number, Decimal>()
      for (const line of lines) {
        const ratePercent = Number(line.taxRate.mul(100).toFixed(2))
        taxBreakdownMap.set(ratePercent, (taxBreakdownMap.get(ratePercent) ?? new Decimal(0)).add(line.taxAmount))
      }
      const taxBreakdown = [...taxBreakdownMap.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([ratePercent, amount]) => ({
          ratePercent,
          taxAmount: roundMoney(amount).toFixed(2),
        }))
      const totalAmount = grossAmount.add(shippingAmount).sub(discountAmount).sub(eftDiscountAmount)
      const deliveryAddress = formatAddress(address)
      const formattedBillingAddress = formatAddress(billingAddress)

      return {
        cart: {
          id: cart.id,
          couponCode,
          items: cart.items.map((item) => ({
            productId: item.productId,
            variantId: item.variantId ?? null,
          quantity: item.quantity,
        })),
      },
      address,
      customer,
      lines,
      grossAmount,
      netSubtotal,
      shippingAmount,
      discountAmount,
      couponId,
      eftDiscountAmount,
      eftDiscountRate,
      taxAmount,
      taxBreakdown,
      totalAmount,
      legalContext: {
        buyer: {
          fullName: fallbackText(customer.name, address.fullName),
          email: fallbackText(customer.email, '-'),
          phone: fallbackText(address.phone, '-'),
          deliveryAddress,
          billingAddress: formattedBillingAddress,
        },
        sellers: Array.from(sellerMap.values()),
        items: lines.map((line) => ({
          productId: line.productId,
          productName: line.productName,
          variantName: line.variantName,
          quantity: line.quantity,
          unitPrice: decimalToNumber(line.unitPrice),
          lineTotal: decimalToNumber(line.totalPrice),
          sellerId: line.sellerId,
          sellerStoreName:
            sellerMap.get(line.sellerId)?.storeName ?? 'Satıcı Mağazası',
        })),
        orderDate: new Date(),
        paymentMethod: params.paymentMethod,
        subtotalAmount: decimalToNumber(grossAmount),
        shippingAmount: decimalToNumber(shippingAmount),
        taxAmount: decimalToNumber(taxAmount),
        totalAmount: decimalToNumber(totalAmount),
      },
    }
  }

  return {
    /**
     * Sepet içeriğini doğrular - checkout'a geçmeden önce çağrılır.
     * Stok, fiyat değişiklikleri ve ürün durumu kontrol edilir.
     */
    async validateCart(userId: string) {
      const cart = await carts.findByUserId(userId)
      if (!cart || cart.items.length === 0) {
        throw new ValidationError('Sepet boş veya bulunamadı')
      }

      const productIds = cart.items.map((i: { productId: string }) => i.productId)
      const products = await prisma.product.findMany({
        where: { id: { in: productIds } },
        include: { variants: true },
      })

      const warnings: string[] = []
      const errors: string[] = []

      for (const item of cart.items as Array<{
        productId: string
        variantId: string | null
        quantity: number
        unitPrice: Decimal
      }>) {
        const product = products.find((p) => p.id === item.productId)

        if (!product || product.status !== 'published') {
          errors.push('Ürün artık mevcut değil')
          continue
        }

        const variant = item.variantId
          ? product.variants.find((entry) => entry.id === item.variantId)
          : null

        if (product.variants.length > 0 && !variant) {
          errors.push(`"${product.name}" için varyasyon seçimi geçersiz`)
          continue
        }

        const availableStock = variant?.stockQuantity ?? product.stockQuantity
        if (availableStock < item.quantity) {
          errors.push(
            `"${product.name}" için yeterli stok yok (mevcut: ${availableStock})`,
          )
          continue
        }

        const currentPrice =
          variant?.price ?? product.price

        if (!new Decimal(item.unitPrice).eq(currentPrice)) {
          warnings.push(
            `"${product.name}" fiyatı değişti: ${formatMoney(item.unitPrice)} -> ${formatMoney(currentPrice)}`,
          )
        }
      }

      return { valid: errors.length === 0, errors, warnings }
    },

    async previewLegalDocuments(params: {
      userId: string
      addressId: string
      billingAddressId?: string
      paymentMethod: CheckoutPaymentMethod
    }) {
      const draft = await buildCheckoutDraft(params)
      return renderLegalDocuments(draft.legalContext)
    },

    /**
     * Sepetten sipariş oluşturur.
     *
     * Tutarlar sunucu tarafında yeniden hesaplanır - client'tan gelen değerler kullanılmaz.
     * Kargo ücreti: 1.500 TL üzeri ücretsiz, altı 99 TL.
     * Komisyon: sistem varsayılan %15 (CLAUDE.md 15.1).
     *
     * İdempotency: aynı idempotencyKey ile ikinci çağrı mevcut siparişi döndürür.
     */
    async createOrder(params: {
      userId: string
      addressId: string
      billingAddressId?: string
      paymentMethod: CheckoutPaymentMethod
      couponCode?: string
      idempotencyKey?: string
      notes?: string
      legalAcceptance: LegalAcceptanceEvidence
    }) {
      const draft = await buildCheckoutDraft(params)

      const result = await prisma.$transaction(async (tx) => {
        const order = await tx.order.create({
          data: {
            customerId: params.userId,
            addressId: params.addressId,
            ...(params.billingAddressId !== undefined
              ? { billingAddressId: params.billingAddressId }
              : {}),
            status: 'checkout_started',
            grossAmount: draft.grossAmount,
            netSubtotal: draft.netSubtotal,
            discountAmount: draft.discountAmount,
            shippingAmount: draft.shippingAmount,
            taxAmount: draft.taxAmount,
            taxBreakdownJson: draft.taxBreakdown as unknown as Prisma.InputJsonValue,
            eftDiscountAmount: draft.eftDiscountAmount,
            ...(draft.eftDiscountRate.gt(0)
              ? { eftDiscountRateSnapshot: draft.eftDiscountRate }
              : {}),
            totalAmount: draft.totalAmount,
            couponCode: params.couponCode ?? draft.cart.couponCode,
            ...(params.notes !== undefined ? { notes: params.notes } : {}),
            lines: {
              create: draft.lines,
            },
          },
          include: { lines: true },
        })

        await tx.orderStatusHistory.create({
          data: {
            orderId: order.id,
            toStatus: 'checkout_started',
            actorId: params.userId,
            reason: 'Checkout başlatıldı',
          },
        })

        const legalBundle = renderLegalDocuments({
          ...draft.legalContext,
          orderNumber: formatOrderNumber(order.publicNumber, order.id),
          orderDate: order.createdAt,
        })

        await tx.orderLegalSnapshot.create({
          data: {
            orderId: order.id,
            distanceSalesHtml: legalBundle.distanceSalesHtml,
            preInformationHtml: legalBundle.preInformationHtml,
            distanceSalesVersion: legalBundle.distanceSalesVersion,
            preInformationVersion: legalBundle.preInformationVersion,
            distanceSalesHash: hashLegalDocumentHtml(legalBundle.distanceSalesHtml),
            preInformationHash: hashLegalDocumentHtml(legalBundle.preInformationHtml),
            acceptedDistanceSalesAt: params.legalAcceptance.acceptedAt,
            acceptedPreInformationAt: params.legalAcceptance.acceptedAt,
            acceptedIp: params.legalAcceptance.ipAddress,
            acceptedUserAgent: params.legalAcceptance.userAgent,
            acceptedSessionId: params.legalAcceptance.sessionId,
            buyerSnapshot: legalBundle.buyerSnapshot as unknown as Prisma.InputJsonValue,
            sellerSnapshot: legalBundle.sellerSnapshot as unknown as Prisma.InputJsonValue,
            platformSnapshot: legalBundle.platformSnapshot as unknown as Prisma.InputJsonValue,
          },
        })

        const payment = await tx.payment.create({
          data: {
            orderId: order.id,
            method: params.paymentMethod,
            status: 'pending',
            amount: draft.totalAmount,
          },
        })

        const nextStatus =
          params.paymentMethod === 'eft' ? 'bank_transfer_waiting' : 'payment_pending'

        await tx.order.update({
          where: { id: order.id },
          data: { status: nextStatus },
        })

        await tx.orderStatusHistory.create({
          data: {
            orderId: order.id,
            fromStatus: 'checkout_started',
            toStatus: nextStatus,
            actorId: params.userId,
            reason:
              params.paymentMethod === 'eft'
                ? 'Havale/EFT bekleniyor'
                : 'Kart ödemesi bekleniyor',
          },
        })

        // Stok atomik olarak azalt - race condition'a karşı transaction içinde yapılıyor
        for (const line of draft.lines) {
          if (line.variantId) {
            const updated = await tx.productVariant.updateMany({
              where: { id: line.variantId, stockQuantity: { gte: line.quantity } },
              data: { stockQuantity: { decrement: line.quantity } },
            })
            if (updated.count === 0) {
              throw new ConflictError(
                `"${line.productName}" varyasyonu için yeterli stok kalmadı. Lütfen sepeti güncelleyin.`,
              )
            }
          } else {
            const updated = await tx.product.updateMany({
              where: { id: line.productId, stockQuantity: { gte: line.quantity } },
              data: { stockQuantity: { decrement: line.quantity } },
            })
            if (updated.count === 0) {
              throw new ConflictError(
                `"${line.productName}" için yeterli stok kalmadı. Lütfen sepeti güncelleyin.`,
              )
            }
          }
        }

        if (params.paymentMethod === 'eft') {
          await tx.cartItem.deleteMany({
            where: { cart: { userId: params.userId } },
          })
        }

        // Kupon kullanımını kaydet (CouponUsage + usageCount) — aynı transaction
        // içinde, sipariş oluşturma ile atomik. orderId unique kısıtı idempotency
        // sağlar (aynı sipariş için ikinci applyCoupon çağrısı P2002 fırlatır).
        if (draft.couponId) {
          await couponService.applyCoupon({
            couponId: draft.couponId,
            userId: params.userId,
            orderId: order.id,
            tx: tx as unknown as PrismaClient,
          })
        }

        return { order, payment, lines: order.lines }
      })

      const bankTransferInstructions =
        params.paymentMethod === 'eft'
          ? await createPlatformBankAccountService({ prisma })
              .listActive()
              .then((accounts) =>
                accounts.length > 0
                  ? accounts.map((account) => ({
                      bankName: account.bankName,
                      accountHolder: account.accountHolder,
                      accountHolderNote: account.accountHolderNote,
                      iban: account.iban,
                      branchName: account.branchName,
                    }))
                  : getPlatformBankInfo(result.order.id),
              )
              .catch(() => getPlatformBankInfo(result.order.id))
          : undefined

      void enqueueNotification({
        userId: params.userId,
        emailTo: draft.customer.email,
        type: 'order_placed',
        title: `Siparişiniz Alındı - ${formatOrderDisplayNumber(result.order.publicNumber, result.order.id)}`,
        body: 'Siparişiniz başarıyla alındı.',
        data: {
          orderId: result.order.id,
          orderNumber: formatOrderNumber(result.order.publicNumber, result.order.id),
          paymentMethod: params.paymentMethod,
          items: result.lines.map((line) => ({
            name: line.productName,
            quantity: line.quantity,
            price: formatMoney(line.unitPrice),
          })),
          totalAmount: formatMoney(result.order.totalAmount),
          customerName: draft.customer.name ?? draft.address.fullName,
          ...(bankTransferInstructions ? { bankTransferInstructions } : {}),
        },
      }).catch((err) => console.error('[checkout] Order confirmation notification failed:', err))

      return {
        ...result,
        ...(bankTransferInstructions ? { bankTransferInstructions } : {}),
      }
    },

    /**
     * Sipariş oluşturulduktan sonra sepeti temizler.
     * Geriye dönük uyumluluk için tutulur.
     */
    async clearCartAfterOrder(userId: string) {
      const cart = await carts.findByUserId(userId)
      if (!cart) return
      await carts.clearCart(cart.id)
    },

    /**
     * Kullanıcının kayıtlı adreslerini döndürür.
     */
    getAddresses(userId: string) {
      return prisma.address.findMany({
        where: { userId },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
      })
    },

    /**
     * Yeni adres ekler.
     */
    async addAddress(
      userId: string,
      data: {
        label?: string
        fullName: string
        phone: string
        addressLine1: string
        addressLine2?: string
        district: string
        city: string
        postalCode?: string
        isDefault?: boolean
        isBillingAddress?: boolean
        invoiceType?: 'individual' | 'corporate'
        tcNumber?: string
        isForeignNational?: boolean
        companyName?: string
        taxOffice?: string
        taxNumber?: string
      },
    ) {
      if (data.isDefault) {
        await prisma.address.updateMany({
          where: { userId, isDefault: true },
          data: { isDefault: false },
        })
      }
      return prisma.address.create({ data: { ...data, postalCode: data.postalCode ?? '', userId } })
    },
  }
}

export type CheckoutService = ReturnType<typeof createCheckoutService>
