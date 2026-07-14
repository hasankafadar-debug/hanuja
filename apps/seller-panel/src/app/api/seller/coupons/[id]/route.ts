/**
 * Satıcı kuponu güncelleme — yalnız aktif/pasif, son geçerlilik tarihi ve
 * toplam kullanım limiti değiştirilebilir. Kod/tip/değer sonradan değiştirilemez
 * (mevcut kullanımların anlamını korumak için — bkz. coupon.service.ts).
 * Sahiplik kontrolü serviste yapılır (NotFoundError — başka satıcının kuponunun
 * varlığını sızdırmamak için 403 yerine 404 döner).
 */
import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { handleError, ok } from '@hanuja/api/lib/response'
import { createCouponService } from '@hanuja/api/services/coupon.service'
import { getActiveSellerIdOrThrow } from '@/lib/route-seller'

const updateCouponSchema = z.object({
  isActive: z.boolean().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  maxUsageTotal: z.number().int().min(1).nullable().optional(),
})

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const sellerId = await getActiveSellerIdOrThrow()
    const { id } = await params
    const body = updateCouponSchema.parse(await req.json())

    const service = createCouponService({ prisma: createPrismaForRoute() })
    const coupon = await service.updateSellerCoupon({
      sellerId,
      couponId: id,
      ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
      ...(body.expiresAt !== undefined
        ? { expiresAt: body.expiresAt ? new Date(body.expiresAt) : null }
        : {}),
      ...(body.maxUsageTotal !== undefined ? { maxUsageTotal: body.maxUsageTotal } : {}),
    })

    return ok({ coupon })
  } catch (error) {
    return handleError(error)
  }
}
