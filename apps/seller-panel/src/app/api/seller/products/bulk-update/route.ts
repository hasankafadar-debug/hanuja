import { headers } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { auth } from '@/lib/auth'
import { MAX_BULK_UPDATE_ROWS } from '@/lib/bulk-product-update'

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }
const prisma = globalForPrisma.prisma ?? new PrismaClient()
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

type BulkUpdateInputRow = { identifier: string; newPrice?: number; newStock?: number }

async function buildPreview(sellerId: string, rows: BulkUpdateInputRow[]) {
  const results: Array<{
    identifier: string
    status: 'matched' | 'not_found' | 'invalid' | 'noop' | 'updated'
    productId?: string
    productName?: string
    oldPrice?: number
    newPrice?: number
    oldStock?: number
    newStock?: number
    message?: string
  }> = []

  for (const row of rows) {
    const identifier = row.identifier.trim()
    if (!identifier) {
      results.push({ identifier, status: 'invalid', message: 'Kimlik alani bos olamaz' })
      continue
    }

    const product = await prisma.product.findFirst({
      where: {
        sellerId,
        barcode: identifier,
      },
      select: {
        id: true,
        name: true,
        price: true,
        stockQuantity: true,
      },
    })

    if (!product) {
      results.push({ identifier, status: 'not_found', message: 'Barkod ile urun bulunamadi' })
      continue
    }

    const oldPrice = product.price.toNumber()
    const oldStock = product.stockQuantity
    const newPrice = row.newPrice ?? oldPrice
    const newStock = row.newStock ?? oldStock
    const sameValues = newPrice === oldPrice && newStock === oldStock

    results.push({
      identifier,
      status: sameValues ? 'noop' : 'matched',
      productId: product.id,
      productName: product.name,
      oldPrice,
      newPrice,
      oldStock,
      newStock,
      ...(sameValues ? { message: 'Ayni degerler oldugu icin atlanacak' } : {}),
    })
  }

  return results
}

export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return NextResponse.json({ error: 'Yetkisiz.' }, { status: 401 })
  }

  const seller = await prisma.seller.findUnique({ where: { userId: session.user.id } })
  if (!seller) {
    return NextResponse.json({ error: 'Satici hesabi bulunamadi.' }, { status: 404 })
  }

  const body = (await req.json().catch(() => ({}))) as {
    rows?: BulkUpdateInputRow[]
    apply?: boolean
  }
  const rows = Array.isArray(body.rows) ? body.rows : []

  if (rows.length === 0) {
    return NextResponse.json({ error: 'Guncellenecek satir bulunamadi.' }, { status: 400 })
  }

  if (rows.length > MAX_BULK_UPDATE_ROWS) {
    return NextResponse.json(
      { error: `Bir seferde en fazla ${MAX_BULK_UPDATE_ROWS} satir yukleyebilirsiniz.` },
      { status: 400 },
    )
  }

  const preview = await buildPreview(seller.id, rows)

  if (!body.apply) {
    return NextResponse.json({ results: preview })
  }

  const results = []
  for (const row of preview) {
    if (
      row.status === 'not_found' ||
      row.status === 'invalid' ||
      row.status === 'noop' ||
      !row.productId
    ) {
      results.push(row)
      continue
    }

    await prisma.product.update({
      where: { id: row.productId },
      data: {
        ...(row.newPrice !== undefined ? { price: row.newPrice } : {}),
        ...(row.newStock !== undefined ? { stockQuantity: row.newStock } : {}),
      },
    })

    if (
      row.oldPrice &&
      row.newPrice &&
      row.oldPrice > 0 &&
      Math.abs((row.newPrice - row.oldPrice) / row.oldPrice) >= 0.5
    ) {
      console.warn('[bulk-update] large price delta', {
        sellerId: seller.id,
        productId: row.productId,
        from: row.oldPrice,
        to: row.newPrice,
      })
    }

    results.push({ ...row, status: 'updated' as const })
  }

  return NextResponse.json({ results })
}
