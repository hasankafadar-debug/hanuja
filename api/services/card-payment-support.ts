import type { Prisma } from '@prisma/client'
import { Prisma as PrismaNamespace } from '@prisma/client'

type LockClient = Pick<Prisma.TransactionClient, '$queryRaw'>

/** Sipariş satırı kilidi: deneme başlatma, auth'a geçiş, onay ve süre dolumu bu kilidi paylaşır. */
export async function lockOrderRow(tx: LockClient, orderId: string) {
  await tx.$queryRaw(PrismaNamespace.sql`SELECT id FROM orders WHERE id = ${orderId} FOR UPDATE`)
}

/** İlk denemede sipariş henüz yokken teklif satırı kilitlenir (çift gönderimde tek sipariş). */
export async function lockQuoteRow(tx: LockClient, quoteId: string) {
  await tx.$queryRaw(
    PrismaNamespace.sql`SELECT id FROM card_payment_quotes WHERE id = ${quoteId} FOR UPDATE`,
  )
}

/** Deneme bazlı geri ödeme kaydı kilidi: callback, webhook ve worker aynı kaydı işler. */
export async function lockReversalRow(tx: LockClient, reversalId: string) {
  await tx.$queryRaw(
    PrismaNamespace.sql`SELECT id FROM card_attempt_reversals WHERE id = ${reversalId} FOR UPDATE`,
  )
}

/**
 * Ödenmeden kapanan siparişin kupon kullanımını geri verir (CouponUsage silinir, sayaç azalır).
 * Kullanım yoksa hiçbir şey yapmaz; aynı transaction'da bir kez çağrılır.
 */
export async function releaseOrderCouponUsage(
  tx: Pick<Prisma.TransactionClient, 'couponUsage' | 'coupon'>,
  orderId: string,
) {
  const usage = await tx.couponUsage.findUnique({ where: { orderId } })
  if (!usage) return false
  await tx.couponUsage.delete({ where: { id: usage.id } })
  await tx.coupon.updateMany({
    where: { id: usage.couponId, usageCount: { gt: 0 } },
    data: { usageCount: { decrement: 1 } },
  })
  return true
}

/**
 * Onayda yalnız satın alınan ürün/varyant adetleri sepetten düşülür; ödeme beklerken
 * sepete eklenen ürünler korunur.
 */
export async function removePurchasedCartItems(
  tx: Pick<Prisma.TransactionClient, 'cartItem'>,
  userId: string,
  lines: Array<{
    productId: string
    variantId: string | null
    quantity: number
  }>,
) {
  const items = await tx.cartItem.findMany({
    where: { cart: { userId } },
    select: { id: true, productId: true, variantId: true, quantity: true },
    orderBy: { id: 'asc' },
  })
  const remainingToRemove = new Map<string, number>()
  for (const line of lines) {
    const key = `${line.productId}:${line.variantId ?? ''}`
    remainingToRemove.set(key, (remainingToRemove.get(key) ?? 0) + line.quantity)
  }
  for (const item of items) {
    const key = `${item.productId}:${item.variantId ?? ''}`
    const toRemove = remainingToRemove.get(key) ?? 0
    if (toRemove <= 0) continue
    if (item.quantity <= toRemove) {
      await tx.cartItem.delete({ where: { id: item.id } })
      remainingToRemove.set(key, toRemove - item.quantity)
    } else {
      await tx.cartItem.update({
        where: { id: item.id },
        data: { quantity: item.quantity - toRemove },
      })
      remainingToRemove.set(key, 0)
    }
  }
}

/** "0532 123 45 67" / "+905321234567" → "+905321234567" (Iyzico gsmNumber). */
export function normalizeTurkishGsm(phone: string | null | undefined): string | undefined {
  if (!phone) return undefined
  const digits = phone.replace(/\D/g, '')
  if (/^905\d{9}$/.test(digits)) return `+${digits}`
  if (/^05\d{9}$/.test(digits)) return `+9${digits}`
  if (/^5\d{9}$/.test(digits)) return `+90${digits}`
  return undefined
}

/** "Ad Soyad Soyad2" → { name: "Ad", surname: "Soyad Soyad2" } */
export function splitFullName(fullName: string | null | undefined): {
  name: string
  surname: string
} {
  const parts = (fullName ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return { name: 'Müşteri', surname: 'Hanuja' }
  if (parts.length === 1) return { name: parts[0]!, surname: parts[0]! }
  return {
    name: parts.slice(0, -1).join(' '),
    surname: parts[parts.length - 1]!,
  }
}

/** Europe/Istanbul takvim günü (aynı gün iptal kararı için). */
export function istanbulDay(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Istanbul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}
