import { headers } from 'next/headers'
import { ok, handleError } from '@hanuja/api/lib/response'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { createProductAnalyticsService } from '@hanuja/api/services/product-analytics.service'
import { auth } from '@/lib/auth'

interface RouteContext {
  params: Promise<{ slug: string }>
}

export async function POST(_req: Request, { params }: RouteContext) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user || session.user.role !== 'customer') {
      return ok({ recorded: false })
    }

    const { slug } = await params
    const prisma = createPrismaForRoute()
    const product = await prisma.product.findUnique({
      where: { slug },
      select: { id: true, status: true },
    })

    if (!product || product.status !== 'published') {
      return ok({ recorded: false })
    }

    const result = await createProductAnalyticsService({ prisma }).recordProductEvent({
      productId: product.id,
      userId: session.user.id,
      eventType: 'product_view',
    })

    return ok(result)
  } catch (err) {
    return handleError(err)
  }
}
