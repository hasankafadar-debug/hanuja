import { createHash } from 'node:crypto'
import type { CardPaymentAttempt, PrismaClient } from '@prisma/client'

type SourceClient = Pick<PrismaClient, 'cart' | 'address'>

/** Read-only fingerprint shared by frozen checkout evidence and cart recovery. */
export async function checkoutSourceFingerprint(
  prisma: SourceClient,
  params: {
    userId: string
    addressId?: string | null
    billingAddressId?: string | null
  },
) {
  const [cart, addresses] = await Promise.all([
    prisma.cart.findUnique({
      where: { userId: params.userId },
      select: {
        couponCode: true,
        items: {
          orderBy: { id: 'asc' },
          select: {
            productId: true,
            variantId: true,
            quantity: true,
            unitPrice: true,
            updatedAt: true,
          },
        },
      },
    }),
    prisma.address.findMany({
      where: {
        userId: params.userId,
        id: { in: [params.addressId ?? '', params.billingAddressId ?? ''] },
      },
      orderBy: { id: 'asc' },
    }),
  ])
  return createHash('sha256').update(JSON.stringify({ cart, addresses })).digest('hex')
}

export async function matchesCheckoutSource(
  prisma: SourceClient,
  order: {
    id: string
    customerId: string
    addressId: string | null
    billingAddressId: string | null
    totalAmount: { toFixed: (digits: number) => string }
    cardPaymentAttempts: Pick<CardPaymentAttempt, 'flow' | 'sourceHash' | 'legalContext'>[]
  },
) {
  // Retry previews have an order-based hash. Match against the original cart evidence,
  // which remains immutable across retries, not the retry's address-less fingerprint.
  const retryHash = createHash('sha256')
    .update(`order:${order.id}:${order.totalAmount.toFixed(2)}`)
    .digest('hex')
  const original = order.cardPaymentAttempts.find(
    (attempt) => attempt.flow === 'checkout_form' && attempt.sourceHash !== retryHash,
  )
  const context = original?.legalContext
  if (!context || typeof context !== 'object' || Array.isArray(context)) return null
  const expected = context.checkoutSourceFingerprint
  if (typeof expected !== 'string') return null // Legacy direct-card orders have no cart evidence.
  return (
    expected ===
    (await checkoutSourceFingerprint(prisma, {
      userId: order.customerId,
      addressId: order.addressId,
      billingAddressId: order.billingAddressId,
    }))
  )
}
