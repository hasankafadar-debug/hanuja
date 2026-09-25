import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { checkCsrf } from '@hanuja/api/lib/csrf-check'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { createMarketingConsentService } from '@hanuja/api/services/marketing-consent.service'

const schema = z.object({ consented: z.boolean(), channel: z.enum(['email', 'sms']).optional(), source: z.enum(['signup', 'account_settings']).optional() })

export async function GET(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session?.user) return NextResponse.json({ message: 'Oturum açmanız gerekiyor.' }, { status: 401 })
  if (session.user.role !== 'customer') return NextResponse.json({ message: 'Bu işlem müşteri hesabına özeldir.' }, { status: 403 })
  const service = createMarketingConsentService(createPrismaForRoute())
  const status = await service.getStatus(session.user.id)
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

  const service = createMarketingConsentService(createPrismaForRoute())
  if (parsed.data.consented) {
    return NextResponse.json({ message: 'İYS hazırlığı tamamlanana kadar yeni iletişim izni alınmıyor.' }, { status: 409 })
  } else {
    // Legacy bulk withdrawal remains compatible; a grant can never revive SMS.
    for (const channel of parsed.data.channel ? [parsed.data.channel] : ['email', 'sms'] as const)
      await service.revokeByUser(session.user.id, channel, 'account_settings')
  }
  const status = await service.getStatus(session.user.id)
  return NextResponse.json(status)
}
