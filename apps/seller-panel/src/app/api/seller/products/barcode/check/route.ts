import { headers } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { checkUserRateLimit, API_RATE_LIMIT } from '@hanuja/api/lib/rate-limit'
import { normalizeImportBarcode } from '@hanuja/api/services/product-import/barcode'

export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return NextResponse.json({ error: 'Yetkisiz.' }, { status: 401 })
  }

  // Barkod uzayı satıcılar arası ortak — enumerasyon denemelerini sınırla
  const rl = await checkUserRateLimit(session.user.id, 'products:barcode-check', API_RATE_LIMIT)
  if (!rl.allowed) return rl.response!

  const prisma = createPrismaForRoute()
  const seller = await prisma.seller.findUnique({
    where: { userId: session.user.id },
    select: { id: true, status: true, sellerNumber: true },
  })

  if (!seller) {
    return NextResponse.json({ error: 'Satıcı hesabı bulunamadı.' }, { status: 404 })
  }

  if (seller.status !== 'active') {
    return NextResponse.json(
      { error: 'Satıcı hesabınız aktif değil.' },
      { status: 403 },
    )
  }

  const body = (await req.json().catch(() => ({}))) as { barcode?: unknown }
  const input = typeof body.barcode === 'string' ? body.barcode.trim() : ''

  if (!input) {
    return NextResponse.json(
      { input, normalized: null, available: false, reason: 'invalid' },
    )
  }

  const normalized = normalizeImportBarcode(input, seller.sellerNumber)

  if (!normalized) {
    return NextResponse.json(
      { input, normalized: null, available: false, reason: 'invalid' },
    )
  }

  const [existingProduct, existingVariant] = await Promise.all([
    prisma.product.findFirst({ where: { barcode: normalized }, select: { id: true } }),
    prisma.productVariant.findFirst({ where: { barcode: normalized }, select: { id: true } }),
  ])

  const inUse = Boolean(existingProduct || existingVariant)

  return NextResponse.json({
    input,
    normalized,
    available: !inUse,
    ...(inUse ? { reason: 'in_use' as const } : {}),
  })
}
