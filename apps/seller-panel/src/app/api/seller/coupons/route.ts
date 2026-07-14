/**
 * Satıcı kuponu CRUD — GET (kendi kuponları), POST (oluştur).
 * `sellerId` her zaman `getActiveSellerIdOrThrow()`'dan gelir — client body'sinden
 * asla sellerId alınmaz (09-seller-panel-rules.md, seller data isolation).
 *
 * İş kuralı: satıcı kuponunun maliyeti satıcının hakedişinden düşer
 * (07-marketplace-finance-rules.md — coupon share). Kupon oluşturma/güncelleme
 * mantığı api/services/coupon.service.ts'te merkezi tutulur — bu route ince kalır.
 */
import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { handleError, ok, created } from '@hanuja/api/lib/response'
import { createCouponService } from '@hanuja/api/services/coupon.service'
import { getActiveSellerIdOrThrow } from '@/lib/route-seller'

const createCouponSchema = z.object({
  code: z.string().trim().min(3).max(40),
  discountType: z.enum(['percentage', 'fixed_amount']),
  discountValue: z.number().positive(),
  minCartTotal: z.number().min(0).nullable().optional(),
  maxUsageTotal: z.number().int().min(1).nullable().optional(),
  maxUsagePerUser: z.number().int().min(1).optional(),
  // ISO datetime string; null/undefined = süresiz
  expiresAt: z.string().datetime().nullable().optional(),
})

export async function GET(req: NextRequest) {
  try {
    const sellerId = await getActiveSellerIdOrThrow()
    const url = new URL(req.url)
    const page = Math.max(1, Number(url.searchParams.get('page') ?? '1'))
    const take = Math.min(100, Math.max(1, Number(url.searchParams.get('take') ?? '50')))
    const skip = (page - 1) * take

    const service = createCouponService({ prisma: createPrismaForRoute() })
    const coupons = await service.listBySeller(sellerId, { skip, take })

    return ok({ coupons })
  } catch (error) {
    return handleError(error)
  }
}

export async function POST(req: NextRequest) {
  try {
    const sellerId = await getActiveSellerIdOrThrow()
    const body = createCouponSchema.parse(await req.json())

    const service = createCouponService({ prisma: createPrismaForRoute() })
    const coupon = await service.createSellerCoupon({
      sellerId,
      code: body.code,
      discountType: body.discountType,
      discountValue: body.discountValue,
      ...(body.minCartTotal !== undefined ? { minCartTotal: body.minCartTotal } : {}),
      ...(body.maxUsageTotal !== undefined ? { maxUsageTotal: body.maxUsageTotal } : {}),
      ...(body.maxUsagePerUser !== undefined ? { maxUsagePerUser: body.maxUsagePerUser } : {}),
      ...(body.expiresAt !== undefined
        ? { expiresAt: body.expiresAt ? new Date(body.expiresAt) : null }
        : {}),
    })

    return created({ coupon })
  } catch (error) {
    return handleError(error)
  }
}
