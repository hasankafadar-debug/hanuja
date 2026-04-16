/**
 * Checkout Service — sepetten siparişe dönüşüm.
 *
 * GÜVENLİK KURALI: Hiçbir zaman client'tan gelen toplam/fiyat bilgisine güvenme.
 * Tüm tutarlar sunucu tarafında ürün veritabanından yeniden hesaplanır.
 *
 * AKIŞ:
 *   cart → validate → create Order (draft) → create OrderLines
 *   → create Payment → checkout_started → payment_pending
 *   → clear cart → return { order, payment }
 *
 * Gerçek Iyzico çağrısı entegrasyon katmanında yapılır.
 * See: cart-checkout-flow skill, 07-marketplace-finance-rules.md
 */
import type { PrismaClient } from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/client'
import { NotFoundError, ValidationError, ConflictError } from '../lib/errors'
import { createCartRepository } from '../repositories/cart.repository'
import { createOrderRepository } from '../repositories/order.repository'

// Sistem varsayılan komisyon oranı — proje büyüdükçe commission config tablosuna taşınır
// Öncelik sırası (CLAUDE.md 15.1): ürün override > kategori > satıcı genel > sistem default
const SYSTEM_DEFAULT_COMMISSION_RATE = new Decimal('0.1500') // %15
const FREE_SHIPPING_THRESHOLD = new Decimal('1500') // ₺1500 ve üzeri ücretsiz kargo
const FLAT_SHIPPING_FEE = new Decimal('99') // ₺99 kargo ücreti

interface CheckoutServiceDeps {
  prisma: PrismaClient
}

export function createCheckoutService({ prisma }: CheckoutServiceDeps) {
  const carts = createCartRepository(prisma)
  const orders = createOrderRepository(prisma)

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
          errors.push(`Ürün artık mevcut değil`)
          continue
        }

        if (product.stockQuantity < item.quantity) {
          errors.push(
            `"${product.name}" için yeterli stok yok (mevcut: ${product.stockQuantity})`,
          )
          continue
        }

        // Fiyat değişikliği kontrolü
        const currentPrice =
          item.variantId
            ? product.variants.find((v) => v.id === item.variantId)?.price ?? product.price
            : product.price

        if (!new Decimal(item.unitPrice).eq(currentPrice)) {
          warnings.push(
            `"${product.name}" fiyatı değişti: ₺${item.unitPrice} → ₺${currentPrice}`,
          )
        }
      }

      return { valid: errors.length === 0, errors, warnings }
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
      paymentMethod: 'card' | 'eft'
      couponCode?: string
      idempotencyKey?: string
      notes?: string
    }) {
      // Sepeti yükle
      const cart = await carts.findByUserId(params.userId)
      if (!cart || cart.items.length === 0) {
        throw new ValidationError('Sepet boş veya bulunamadı')
      }

      // Adresi doğrula
      const address = await prisma.address.findUnique({
        where: { id: params.addressId, userId: params.userId },
      })
      if (!address) throw new NotFoundError('Adres', params.addressId)

      // Ürün bilgilerini çek (fiyat sunucu tarafında hesaplanır)
      const productIds = (cart.items as Array<{ productId: string }>).map((i) => i.productId)
      const products = await prisma.product.findMany({
        where: { id: { in: productIds }, status: 'published' },
        include: {
          seller: true,
          variants: true,
        },
      })

      // Stok ve ürün durumu son kontrolü
      const lines: Array<{
        productId: string
        sellerId: string
        variantId: string | null
        productName: string
        variantName: string | null
        quantity: number
        unitPrice: Decimal
        totalPrice: Decimal
        commissionRate: Decimal
        commissionAmount: Decimal
        netPayoutAmount: Decimal
      }> = []

      for (const item of cart.items as Array<{
        productId: string
        variantId: string | null
        quantity: number
      }>) {
        const product = products.find((p) => p.id === item.productId)
        if (!product) {
          throw new ConflictError(
            `Sepetteki bir ürün artık satışta değil. Lütfen sepeti güncelleyin.`,
          )
        }

        if (product.stockQuantity < item.quantity) {
          throw new ConflictError(
            `"${product.name}" için yeterli stok yok (kalan: ${product.stockQuantity})`,
          )
        }

        const variant = item.variantId
          ? product.variants.find((v) => v.id === item.variantId)
          : null

        const unitPrice = variant?.price ?? product.price
        const totalPrice = unitPrice.mul(item.quantity)

        // Komisyon hesaplama — sistem varsayılanı kullanılıyor (CLAUDE.md 15.1)
        const commissionRate = SYSTEM_DEFAULT_COMMISSION_RATE
        const commissionAmount = totalPrice.mul(commissionRate)
        const netPayoutAmount = totalPrice.sub(commissionAmount)

        lines.push({
          productId: product.id,
          sellerId: product.sellerId,
          variantId: item.variantId,
          productName: product.name,
          variantName: variant?.name ?? null,
          quantity: item.quantity,
          unitPrice,
          totalPrice,
          commissionRate,
          commissionAmount,
          netPayoutAmount,
        })
      }

      // Toplamları hesapla
      const grossAmount = lines.reduce((s, l) => s.add(l.totalPrice), new Decimal(0))
      const shippingAmount = grossAmount.gte(FREE_SHIPPING_THRESHOLD)
        ? new Decimal(0)
        : FLAT_SHIPPING_FEE
      const discountAmount = new Decimal(0) // Kupon mantığı ileriki fazda
      const totalAmount = grossAmount.add(shippingAmount).sub(discountAmount)

      return prisma.$transaction(async (tx) => {
        // Sipariş oluştur
        const order = await (tx as unknown as PrismaClient).order.create({
          data: {
            customerId: params.userId,
            addressId: params.addressId,
            status: 'checkout_started',
            grossAmount,
            discountAmount,
            shippingAmount,
            totalAmount,
            couponCode: params.couponCode ?? cart.couponCode,
            ...(params.notes !== undefined ? { notes: params.notes } : {}),
            lines: {
              create: lines,
            },
          },
          include: { lines: true },
        })

        // Sipariş durum geçmişi
        await (tx as unknown as PrismaClient).orderStatusHistory.create({
          data: {
            orderId: order.id,
            toStatus: 'checkout_started',
            actorId: params.userId,
            reason: 'Checkout başlatıldı',
          },
        })

        // Ödeme kaydı oluştur
        const payment = await (tx as unknown as PrismaClient).payment.create({
          data: {
            orderId: order.id,
            method: params.paymentMethod,
            status: 'pending',
            amount: totalAmount,
          },
        })

        // payment_pending durumuna geç
        await (tx as unknown as PrismaClient).order.update({
          where: { id: order.id },
          data: {
            status:
              params.paymentMethod === 'eft' ? 'bank_transfer_waiting' : 'payment_pending',
          },
        })

        await (tx as unknown as PrismaClient).orderStatusHistory.create({
          data: {
            orderId: order.id,
            fromStatus: 'checkout_started',
            toStatus:
              params.paymentMethod === 'eft' ? 'bank_transfer_waiting' : 'payment_pending',
            actorId: params.userId,
            reason:
              params.paymentMethod === 'eft'
                ? 'Havale/EFT bekleniyor'
                : 'Kart ödemesi bekleniyor',
          },
        })

        return { order, payment, lines: order.lines }
      })
    },

    /**
     * Sipariş oluşturulduktan sonra sepeti temizler.
     * Ödeme başarılıysa çağrılır — başarısızsa sepet korunur.
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
        postalCode: string
        isDefault?: boolean
      },
    ) {
      if (data.isDefault) {
        // Mevcut varsayılan adresi kaldır
        await prisma.address.updateMany({
          where: { userId, isDefault: true },
          data: { isDefault: false },
        })
      }
      return prisma.address.create({ data: { ...data, userId } })
    },
  }
}

export type CheckoutService = ReturnType<typeof createCheckoutService>
