import { NextRequest, NextResponse } from 'next/server'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { createStoreFollowService } from '@hanuja/api/services/store-follow.service'
import { checkRateLimit, API_RATE_LIMIT } from '@hanuja/api/lib/rate-limit'

export async function GET(req: NextRequest) {
  // Unauthenticated + tokenful: key by IP with the loosest tier so a legitimate
  // one-click unsubscribe is never effectively blocked, while abusive scanning is capped.
  const rl = await checkRateLimit(req, 'store-follows:unsubscribe', API_RATE_LIMIT)
  if (!rl.allowed) return rl.response!

  const token = req.nextUrl.searchParams.get('token')?.trim()
  if (!token) {
    return NextResponse.json({ error: 'Token gerekli.' }, { status: 400 })
  }

  const service = createStoreFollowService({ prisma: createPrismaForRoute() })
  const result = await service.unsubscribeByToken(token)

  if (!result) {
    return NextResponse.json({ error: 'Geçersiz çıkış bağlantısı.' }, { status: 404 })
  }

  return NextResponse.json({ ok: true })
}
