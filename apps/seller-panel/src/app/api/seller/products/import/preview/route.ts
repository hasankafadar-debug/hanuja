import { headers } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { checkUserRateLimit, SENSITIVE_RATE_LIMIT } from '@hanuja/api/lib/rate-limit'
import { createProductImportService } from '@hanuja/api/services/product-import/import.service'

export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return NextResponse.json({ error: 'Yetkisiz.' }, { status: 401 })
  }

  // Uzak sayfa çekme + parse maliyetli — istek hızını sınırla
  const rl = await checkUserRateLimit(session.user.id, 'products:import-preview', SENSITIVE_RATE_LIMIT)
  if (!rl.allowed) return rl.response!

  const prisma = createPrismaForRoute()
  const seller = await prisma.seller.findUnique({
    where: { userId: session.user.id },
    select: { id: true, status: true, sellerNumber: true, importEnabled: true },
  })

  if (!seller) {
    return NextResponse.json({ error: 'Satıcı hesabı bulunamadı.' }, { status: 404 })
  }

  if (seller.status !== 'active') {
    return NextResponse.json(
      { error: 'Ürün içe aktarmak için satıcı hesabınız aktif olmalı.' },
      { status: 403 },
    )
  }

  if (!seller.importEnabled) {
    return NextResponse.json(
      { error: 'Import izniniz bulunmuyor.' },
      { status: 403 },
    )
  }

  const body = (await req.json().catch(() => ({}))) as { url?: unknown }
  const url = typeof body.url === 'string' ? body.url.trim() : ''

  if (!url) {
    return NextResponse.json({ error: 'Hipicon mağaza URLsi zorunludur.' }, { status: 400 })
  }

  try {
    const service = createProductImportService({ prisma })
    const preview = await service.preview(url, seller.sellerNumber)
    return NextResponse.json(preview)
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Hipicon önizlemesi alınmadı.',
      },
      { status: 400 },
    )
  }
}
