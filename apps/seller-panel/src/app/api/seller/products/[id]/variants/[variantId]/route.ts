import { headers } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { Decimal } from '@prisma/client/runtime/client'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'

const updateVariantSchema = z
  .object({
    price: z.number().positive('Fiyat 0dan buyuk olmali').optional(),
    stockQuantity: z.number().int('Stok tam sayi olmali').min(0, 'Stok negatif olamaz').optional(),
  })
  .refine((data) => data.price !== undefined || data.stockQuantity !== undefined, { message: 'Fiyat veya stok alanlarindan en az biri gonderilmelidir.' })

interface RouteParams {
  params: Promise<{ id: string; variantId: string }>
}

function isSerializableConflict(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2034'
}

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return NextResponse.json({ error: 'Yetkisiz.' }, { status: 401 })
  }

  const prisma = createPrismaForRoute()
  const seller = await prisma.seller.findUnique({
    where: { userId: session.user.id },
    select: { id: true },
  })
  if (!seller) {
    return NextResponse.json({ error: 'Satici hesabi bulunamadi.' }, { status: 404 })
  }

  const body = await req.json().catch(() => ({}))
  const parsed = updateVariantSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Gecersiz veri.' }, { status: 400 })
  }

  const { id: productId, variantId } = await params

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const result = await prisma.$transaction(
        async (tx) => {
          const existing = await tx.productVariant.findFirst({
            where: {
              id: variantId,
              productId,
              product: { sellerId: seller.id },
            },
            select: { id: true },
          })
          if (!existing) throw new Error('VARIANT_NOT_FOUND')

          const variant = await tx.productVariant.update({
            where: { id: existing.id },
            data: {
              ...(parsed.data.price !== undefined ? { price: new Decimal(parsed.data.price) } : {}),
              ...(parsed.data.stockQuantity !== undefined ? { stockQuantity: parsed.data.stockQuantity } : {}),
            },
            select: { id: true, price: true, stockQuantity: true },
          })

          const stock = await tx.productVariant.aggregate({
            where: { productId },
            _sum: { stockQuantity: true },
          })
          const product = await tx.product.update({
            where: { id: productId },
            data: { stockQuantity: stock._sum.stockQuantity ?? 0 },
            select: { id: true, stockQuantity: true },
          })

          return { variant, product }
        },
        { isolationLevel: 'Serializable' },
      )

      return NextResponse.json({
        variant: {
          id: result.variant.id,
          price: result.variant.price === null ? null : Number(result.variant.price),
          stockQuantity: result.variant.stockQuantity,
        },
        product: result.product,
      })
    } catch (error) {
      if (error instanceof Error && error.message === 'VARIANT_NOT_FOUND') {
        return NextResponse.json({ error: 'Varyasyon bulunamadi veya erisim izniniz yok.' }, { status: 404 })
      }
      if (isSerializableConflict(error) && attempt < 2) continue
      if (isSerializableConflict(error)) {
        return NextResponse.json(
          {
            error: 'Varyasyon baska bir islemde degisti. Lutfen tekrar deneyin.',
          },
          { status: 409 },
        )
      }
      throw error
    }
  }

  return NextResponse.json({ error: 'Guncelleme tamamlanamadi.' }, { status: 409 })
}
