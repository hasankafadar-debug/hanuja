import { headers } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { createDiscountService } from '@hanuja/api/services/discount.service'
import { auth } from '@/lib/auth'

const updateDiscountRuleSchema = z.object({
  name: z.string().min(3).max(160).optional(),
  scope: z.enum(['ALL_PRODUCTS', 'CATEGORY', 'PRODUCT']).optional(),
  type: z.enum(['PERCENT', 'FIXED_AMOUNT']).optional(),
  value: z.number().positive().optional(),
  categoryId: z.string().nullable().optional(),
  productIds: z.array(z.string()).optional(),
  startsAt: z.string().datetime().nullable().optional(),
  endsAt: z.string().datetime().nullable().optional(),
  status: z.enum(['ACTIVE', 'SCHEDULED', 'EXPIRED', 'PAUSED']).optional(),
})

async function getSeller() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return null

  const prisma = createPrismaForRoute()
  const seller = await prisma.seller.findUnique({ where: { userId: session.user.id } })
  return seller
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const seller = await getSeller()
  if (!seller) return NextResponse.json({ error: 'Yetkisiz.' }, { status: 401 })

  const { id } = await params
  const service = createDiscountService({ prisma: createPrismaForRoute() })
  const rule = await service.getRule(seller.id, id)

  if (!rule) {
    return NextResponse.json({ error: 'İndirim kuralı bulunamadı.' }, { status: 404 })
  }

  return NextResponse.json({ rule })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const seller = await getSeller()
  if (!seller) return NextResponse.json({ error: 'Yetkisiz.' }, { status: 401 })

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const parsed = updateDiscountRuleSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Geçersiz veri.' },
      { status: 400 },
    )
  }

  try {
    const service = createDiscountService({ prisma: createPrismaForRoute() })
    const updateInput = {
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(parsed.data.scope !== undefined ? { scope: parsed.data.scope } : {}),
      ...(parsed.data.type !== undefined ? { type: parsed.data.type } : {}),
      ...(parsed.data.value !== undefined ? { value: parsed.data.value } : {}),
      ...(parsed.data.categoryId !== undefined ? { categoryId: parsed.data.categoryId } : {}),
      ...(parsed.data.productIds !== undefined ? { productIds: parsed.data.productIds } : {}),
      ...(parsed.data.status !== undefined ? { status: parsed.data.status } : {}),
      ...(parsed.data.startsAt !== undefined
        ? { startsAt: parsed.data.startsAt ? new Date(parsed.data.startsAt) : null }
        : {}),
      ...(parsed.data.endsAt !== undefined
        ? { endsAt: parsed.data.endsAt ? new Date(parsed.data.endsAt) : null }
        : {}),
    }
    const rule = await service.updateRule(seller.id, id, updateInput)

    return NextResponse.json({ rule })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'İndirim güncellenemedi.' },
      { status: 400 },
    )
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const seller = await getSeller()
  if (!seller) return NextResponse.json({ error: 'Yetkisiz.' }, { status: 401 })

  const { id } = await params

  try {
    const service = createDiscountService({ prisma: createPrismaForRoute() })
    await service.deleteRule(seller.id, id)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'İndirim silinemedi.' },
      { status: 404 },
    )
  }
}
