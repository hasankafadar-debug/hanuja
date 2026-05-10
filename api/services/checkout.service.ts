/**
 * Checkout Service — sepetten siparişe dönüşüm.
 *
 * GÜVENLİK KURALI: Hiçbir zaman client'tan gelen toplam/fiyat bilgisine güvenme.
 * Tüm tutarlar sunucu tarafında ürün veritabanından yeniden hesaplanır.
 *
 * AKIŞ:
 *   cart → validate → create Order (draft) → create OrderLines
 *   → create Payment → checkout_started → payment_pending
 *   → ödeme yöntemi eft ise cart clear → return { order, payment }
 *
 * Gerçek Iyzico çağrısı entegrasyon katmanında yapılır.
 * See: cart-checkout-flow skill, 07-marketplace-finance-rules.md
 */
import type { Prisma, PrismaClient } from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/client'
import { calculateIncludedTax, resolveCategoryTaxRate } from '../domain/tax'
import { NotFoundError, ValidationError, ConflictError } from '../lib/errors'
import { createCartRepository } from '../repositories/cart.repository'
import { renderLegalDocuments } from '../lib/legal-documents'
import { enqueueNotification } from '../jobs/notification-dispatch.job'
import { getPlatformBankInfo } from '../lib/platform-info'
import { formatOrderNumber, formatOrderDisplayNumber } from '../lib/order-number'
import { createPlatformSettingsService } from './platform-settings.service'
import { roundMoney } from '@hanuja/security'

// Sistem varsayılan komisyon oranı — proje büyüdükçe commission config tablosuna taşınır
// Öncelik sırası (CLAUDE.md 15.1): ürün override > kategori > satıcı genel > sistem default
const SYSTEM_DEFAULT_COMMISSION_RATE = new Decimal('0.1500') // %15

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
    commissionRate: Decimal
    commissionAmount: Decimal
    netPayoutAmount: Decimal
  }>
  grossAmount: Decimal
  netSubtotal: Decimal
  shippingAmount: Decimal
  discountAmount: Decimal
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

function fallbackText(value: string | null | undefined, placeholder: string) {
  const normalized = value?.trim()
  return normalized && normalized.length > 0 ? normalized : placeholder
}

function formatCurrency(value: Decimal) {
  return `₺${value.toFixed(2).replace('.', ',')}`
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

  async function buildCheckoutDraft(params: {
    userId: string
    addressId: string
    paymentMethod: CheckoutPaymentMethod
  }): Promise<CheckoutDraft> {
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

    const lines: CheckoutDraft['lines'] = []
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
          `"${product.name}" icin varyasyon secimi gecersiz. Lutfen sepeti guncelleyin.`,
        )
      }

      const availableStock = variant?.stockQuantity ?? product.stockQuantity
      if (availableStock < item.quantity) {
        throw new ConflictError(
          `"${product.name}" için yeterli stok yok (kalan: ${availableStock})`,
        )
      }

      const unitPrice = variant?.price ?? product.price
      const totalPrice = unitPrice.mul(item.quantity)
      const taxRate = resolveCategoryTaxRate(product.categoryId, categoryMap, settings.defaultTaxRate)
      const taxAmount = calculateIncludedTax(totalPrice, taxRate)
      const commissionRate = SYSTEM_DEFAULT_COMMISSION_RATE
      const commissionAmount = totalPrice.mul(commissionRate)
      const netPayoutAmount = totalPrice.sub(commissionAmount)

      if (!sellerMap.has(product.sellerId)) {
        sellerMap.set(product.sellerId, buildSellerSnapshot(product.seller))
      }

      lines.push({
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
        commissionAmount,
        netPayoutAmount,
      })
    }

      const grossAmount = lines.reduce((sum, line) => sum.add(line.totalPrice), new Decimal(0))
      const shippingAmount = grossAmount.gte(settings.freeShippingThresholdTry)
        ? new Decimal(0)
        : settings.flatShippingFeeTry
      const discountAmount = new Decimal(0)
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

    return {
      cart: {
        id: cart.id,
        couponCode: cart.couponCode ?? null,
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
          billingAddress: deliveryAddress,
        },
        sellers: Array.from(sellerMap.values()),
        items: lines.map((line) => ({
          productId: line.productId,
          productName: line.productName,
          variantName: line.variantName,
          quantity: line.quantity,
          unitPrice: decimalToNumber(line.unitPrice),
          lineTotal: decimalToNumber(line.totalPrice),
          taxRate: decimalToNumber(line.taxRate),
          taxAmount: decimalToNumber(line.taxAmount),
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
     * Sepet içeriğini doğrular — checkout'a geçmeden önce çağrılır.
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
          errors.push(`"${product.name}" icin varyasyon secimi gecersiz`)
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
            `"${product.name}" fiyatı değişti: ₺${item.unitPrice} → ₺${currentPrice}`,
          )
        }
      }

      return { valid: errors.length === 0, errors, warnings }
    },

    async previewLegalDocuments(params: {
      userId: string
      addressId: string
      paymentMethod: CheckoutPaymentMethod
    }) {
      const draft = await buildCheckoutDraft(params)
      return renderLegalDocuments(draft.legalContext)
    },

    /**
     * Sepetten sipariş oluşturur.
     *
     * Tutarlar sunucu tarafında yeniden hesaplanır — client'tan gelen değerler kullanılmaz.
     * Kargo ücreti: ₺1500 üzeri ücretsiz, altı ₺99.
     * Komisyon: sistem varsayılan %15 (CLAUDE.md 15.1).
     *
     * İdempotency: aynı idempotencyKey ile ikinci çağrı mevcut siparişi döndürür.
     */
    async createOrder(params: {
      userId: string
      addressId: string
      paymentMethod: CheckoutPaymentMethod
      couponCode?: string
      idempotencyKey?: string
      notes?: string
    }) {
      const draft = await buildCheckoutDraft(params)

      const result = await prisma.$transaction(async (tx) => {
        const order = await tx.order.create({
          data: {
            customerId: params.userId,
            addressId: params.addressId,
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

        // Stok atomik olarak azalt — race condition'a karşı transaction içinde yapılıyor
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

        return { order, payment, lines: order.lines }
      })

      void enqueueNotification({
        userId: params.userId,
        emailTo: draft.customer.email,
        type: 'order_placed',
        title: `Siparişiniz Alındı — ${formatOrderDisplayNumber(result.order.publicNumber, result.order.id)}`,
        body: 'Siparişiniz başarıyla alındı.',
        data: {
          orderId: result.order.id,
          orderNumber: formatOrderNumber(result.order.publicNumber, result.order.id),
          paymentMethod: params.paymentMethod,
          items: result.lines.map((line) => ({
            name: line.productName,
            quantity: line.quantity,
            price: formatCurrency(line.unitPrice),
          })),
          totalAmount: formatCurrency(result.order.totalAmount),
          customerName: draft.customer.name ?? draft.address.fullName,
          ...(params.paymentMethod === 'eft'
            ? { bankTransferInstructions: getPlatformBankInfo(result.order.id) }
            : {}),
        },
      }).catch((err) => console.error('[checkout] Order confirmation notification failed:', err))

      return result
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
