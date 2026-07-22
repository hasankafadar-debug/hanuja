import { headers } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { checkUserRateLimit, API_RATE_LIMIT } from '@hanuja/api/lib/rate-limit'

const bodySchema = z.object({
  items: z.array(z.object({ key: z.string().min(1).max(160), barcode: z.string() })).min(1).max(500),
  excludeProductId: z.string().cuid().optional(),
})

/** Batch barcode availability check. Never reveals the barcode owner. */
export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return NextResponse.json({ error: 'Yetkisiz.' }, { status: 401 })

  const rateLimit = await checkUserRateLimit(session.user.id, 'products:barcodes-check', API_RATE_LIMIT)
  if (!rateLimit.allowed) return rateLimit.response!

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Geçersiz barkod kontrol isteği.' }, { status: 400 })

  const prisma = createPrismaForRoute()
  const seller = await prisma.seller.findUnique({
    where: { userId: session.user.id },
    select: { id: true, status: true },
  })
  if (!seller) return NextResponse.json({ error: 'Satıcı hesabı bulunamadı.' }, { status: 404 })
  if (seller.status !== 'active') return NextResponse.json({ error: 'Satıcı hesabınız aktif değil.' }, { status: 403 })

  if (parsed.data.excludeProductId) {
    const owned = await prisma.product.findFirst({
      where: { id: parsed.data.excludeProductId, sellerId: seller.id },
      select: { id: true },
    })
    if (!owned) return NextResponse.json({ error: 'Ürün bulunamadı.' }, { status: 404 })
  }

  const normalizedItems = parsed.data.items.map((item) => ({
    ...item,
    barcode: item.barcode.trim(),
    normalized: /^\d{13}$/.test(item.barcode.trim()) ? item.barcode.trim() : null,
  }))
  const counts = new Map<string, number>()
  for (const item of normalizedItems) {
    if (item.normalized) counts.set(item.normalized, (counts.get(item.normalized) ?? 0) + 1)
  }
  const candidates = [...counts.keys()].filter((barcode) => counts.get(barcode) === 1)
  const reservations = candidates.length
    ? await prisma.barcodeRegistry.findMany({
        where: {
          barcode: { in: candidates },
          ...(parsed.data.excludeProductId
            ? { NOT: { OR: [{ productId: parsed.data.excludeProductId }, { variant: { productId: parsed.data.excludeProductId } }] } }
            : {}),
        },
        select: { barcode: true },
      })
    : []
  const inUse = new Set(reservations.map((item) => item.barcode))

  return NextResponse.json({
    results: normalizedItems.map((item) => {
      if (!item.normalized) {
        return { key: item.key, barcode: item.barcode, normalized: null, status: 'invalid', message: 'Barkod 13 haneli rakam olmalıdır.' }
      }
      if ((counts.get(item.normalized) ?? 0) > 1) {
        return { key: item.key, barcode: item.barcode, normalized: item.normalized, status: 'duplicate_in_request', message: 'Bu barkod formda birden fazla kez kullanılmıştır.' }
      }
      if (inUse.has(item.normalized)) {
        return { key: item.key, barcode: item.barcode, normalized: item.normalized, status: 'in_use', message: 'Bu barkod başka bir ürün veya varyantta kullanılmıştır.' }
      }
      return { key: item.key, barcode: item.barcode, normalized: item.normalized, status: 'available', message: 'Barkod kullanılabilir.' }
    }),
  })
}
