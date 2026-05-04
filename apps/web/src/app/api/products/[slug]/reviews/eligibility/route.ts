import { headers } from 'next/headers'
import { type NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { checkReviewEligibility } from '@hanuja/api/routes/product-reviews'
import { UnauthorizedError } from '@hanuja/api/lib/errors'
import { handleError } from '@hanuja/api/lib/response'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'

// GET /api/products/:slug/reviews/eligibility — can the current user write a review?
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()

    const { slug } = await params
    const prisma = createPrismaForRoute()
    const product = await prisma.product.findUnique({
      where: { slug },
      select: { id: true, status: true },
    })
    if (!product || product.status !== 'published') {
      return NextResponse.json(
        { success: false, code: 'NOT_FOUND', message: 'Ürün bulunamadı' },
        { status: 404 },
      )
    }

    return checkReviewEligibility(product.id, session.user.id)
  } catch (err) {
    return handleError(err)
  }
}
