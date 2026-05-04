import { headers } from 'next/headers'
import { type NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { listProductReviews, submitProductReview } from '@hanuja/api/routes/product-reviews'
import { UnauthorizedError } from '@hanuja/api/lib/errors'
import { handleError } from '@hanuja/api/lib/response'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'

async function resolveProductIdFromSlug(slug: string): Promise<string | null> {
  const prisma = createPrismaForRoute()
  const product = await prisma.product.findUnique({
    where: { slug },
    select: { id: true, status: true },
  })
  if (!product || product.status !== 'published') return null
  return product.id
}

// GET /api/products/:slug/reviews — public approved review list
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params
    const productId = await resolveProductIdFromSlug(slug)
    if (!productId) {
      return NextResponse.json(
        { success: false, code: 'NOT_FOUND', message: 'Ürün bulunamadı' },
        { status: 404 },
      )
    }
    return listProductReviews(req, productId)
  } catch (err) {
    return handleError(err)
  }
}

// POST /api/products/:slug/reviews — submit review (auth required)
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()

    const { slug } = await params
    const productId = await resolveProductIdFromSlug(slug)
    if (!productId) {
      return NextResponse.json(
        { success: false, code: 'NOT_FOUND', message: 'Ürün bulunamadı' },
        { status: 404 },
      )
    }
    return submitProductReview(req, productId, session.user.id)
  } catch (err) {
    return handleError(err)
  }
}
