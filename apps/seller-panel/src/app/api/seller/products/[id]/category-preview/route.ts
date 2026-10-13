import { headers } from 'next/headers'
import { z } from 'zod'
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import {
  resolveCategorySchema,
  categoryChangePreview,
} from '@hanuja/api/services/category-schema.service'
import { handleError } from '@hanuja/api/lib/response'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) return NextResponse.json({ error: 'Yetkisiz.' }, { status: 401 })
    const db = createPrismaForRoute(),
      { id } = await params
    const product = await db.product.findFirst({
      where: { id, seller: { userId: session.user.id } },
      include: { variants: true, attributeValues: { include: { option: true } } },
    })
    if (!product) return NextResponse.json({ error: 'Ürün bulunamadı.' }, { status: 404 })
    const body = z
      .object({
        categoryId: z.string().min(1).max(120),
        contentUnit: z.enum(['ml', 'g', 'adet']).optional(),
      })
      .parse(await req.json())
    const schema = await resolveCategorySchema(db, body.categoryId)
    return NextResponse.json({
      ...categoryChangePreview(product, schema, body.contentUnit),
      schema,
    })
  } catch (error) {
    return handleError(error)
  }
}
