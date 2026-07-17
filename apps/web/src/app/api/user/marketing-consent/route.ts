import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { checkCsrf } from '@hanuja/api/lib/csrf-check'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { createCampaignDiscountService } from '@hanuja/api/services/campaign-discount.service'

const schema = z.object({ consented: z.boolean() })

export async function GET(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session?.user) return NextResponse.json({ message: 'Oturum açmanız gerekiyor.' }, { status: 401 })
  if (session.user.role !== 'customer') return NextResponse.json({ message: 'Bu işlem müşteri hesabına özeldir.' }, { status: 403 })
  const service = createCampaignDiscountService({ prisma: createPrismaForRoute() })
  const status = await service.getMarketingConsentStatus({ userId: session.user.id })
  return NextResponse.json(status)
}

export async function PUT(request: NextRequest) {
  const csrfError = checkCsrf(request)
  if (csrfError) return csrfError
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session?.user) return NextResponse.json({ message: 'Oturum açmanız gerekiyor.' }, { status: 401 })
  if (session.user.role !== 'customer') return NextResponse.json({ message: 'Bu işlem müşteri hesabına özeldir.' }, { status: 403 })
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ message: 'Geçersiz istek.' }, { status: 400 })

  const service = createCampaignDiscountService({ prisma: createPrismaForRoute() })
  if (parsed.data.consented) {
    await service.grantMarketingConsent({ userId: session.user.id, source: 'account_settings' })
  } else {
    await service.revokeMarketingConsentByUser({ userId: session.user.id })
  }
  const status = await service.getMarketingConsentStatus({ userId: session.user.id })
  return NextResponse.json(status)
}
