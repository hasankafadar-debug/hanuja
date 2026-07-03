import { headers } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { createDiscountService } from '@hanuja/api/services/discount.service'
import { createStoreFollowService } from '@hanuja/api/services/store-follow.service'
import { auth } from '@/lib/auth'

const createDiscountRuleSchema = z.object({
  name: z.string().min(3).max(160),
  scope: z.enum(['ALL_PRODUCTS', 'CATEGORY', 'PRODUCT']),
  type: z.enum(['PERCENT', 'FIXED_AMOUNT']),
  value: z.number().positive(),
  categoryId: z.string().nullable().optional(),
  productIds: z.array(z.string()).optional(),
  startsAt: z.string().datetime().nullable().optional(),
  endsAt: z.string().datetime().nullable().optional(),
})

async function getSeller() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return null

  const prisma = createPrismaForRoute()
  const seller = await prisma.seller.findUnique({ where: { userId: session.user.id } })
  return seller
}

export async function GET(req: NextRequest) {
  const seller = await getSeller()
  if (!seller) return NextResponse.json({ error: 'Yetkisiz.' }, { status: 401 })

  const status = req.nextUrl.searchParams.get('status')
  const service = createDiscountService({ prisma: createPrismaForRoute() })
  const rules = await service.listRules(seller.id, status ? { status: status as never } : {})

  return NextResponse.json({ rules })
}

export async function POST(req: NextRequest) {
  const seller = await getSeller()
  if (!seller) return NextResponse.json({ error: 'Yetkisiz.' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const parsed = createDiscountRuleSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Geçersiz veri.' },
      { status: 400 },
    )
  }

  try {
    const prisma = createPrismaForRoute()
    const service = createDiscountService({ prisma })
    const createInput = {
      name: parsed.data.name,
      scope: parsed.data.scope,
      type: parsed.data.type,
      value: parsed.data.value,
      startsAt: parsed.data.startsAt ? new Date(parsed.data.startsAt) : null,
      endsAt: parsed.data.endsAt ? new Date(parsed.data.endsAt) : null,
      ...(parsed.data.categoryId !== undefined ? { categoryId: parsed.data.categoryId } : {}),
      ...(parsed.data.productIds !== undefined ? { productIds: parsed.data.productIds } : {}),
    }
    const rule = await service.createRule(seller.id, createInput)

    if (rule.status === 'ACTIVE') {
      await createStoreFollowService({ prisma }).notifyFollowersAboutDiscount({
        sellerId: seller.id,
        sellerName: seller.displayName,
        sellerSlug: seller.slug,
        discountRuleId: rule.id,
        discountFingerprint: `${rule.id}:${rule.createdAt.toISOString()}`,
      })
    }

    return NextResponse.json({ rule }, { status: 201 })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'İndirim oluşturulamadı.' },
      { status: 400 },
    )
  }
}
