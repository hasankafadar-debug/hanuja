import { headers } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { PrismaClient } from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/client'

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }
const prisma = globalForPrisma.prisma ?? new PrismaClient()
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

async function getSellerOrFail(req: Request) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return null
  const seller = await prisma.seller.findUnique({ where: { userId: session.user.id } })
  return seller
}

/** PATCH /api/seller/products/[id] — update name, description, price, stock */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const seller = await getSellerOrFail(req)
  if (!seller) return NextResponse.json({ error: 'Yetkisiz.' }, { status: 401 })

  const { id } = await params
  const body = await req.json().catch(() => ({}))

  // Verify ownership
  const product = await prisma.product.findUnique({ where: { id, sellerId: seller.id } })
  if (!product) return NextResponse.json({ error: 'Ürün bulunamadı.' }, { status: 404 })

  const updateData: Record<string, unknown> = {}
  if (typeof body.name === 'string' && body.name.trim()) {
    updateData.name = body.name.trim()
  }
  if (typeof body.description === 'string') {
    updateData.description = body.description.trim() || null
  }
  if (typeof body.price === 'number' && body.price >= 0) {
    updateData.price = new Decimal(body.price)
  }
  if (typeof body.stock === 'number' && body.stock >= 0) {
    updateData.stockQuantity = Math.floor(body.stock)
  }

  const updated = await prisma.product.update({ where: { id }, data: updateData })
  return NextResponse.json({ product: { id: updated.id, name: updated.name } })
}

/** DELETE /api/seller/products/[id] — archive the product (not hard delete) */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const seller = await getSellerOrFail(_req)
  if (!seller) return NextResponse.json({ error: 'Yetkisiz.' }, { status: 401 })

  const { id } = await params

  const product = await prisma.product.findUnique({ where: { id, sellerId: seller.id } })
  if (!product) return NextResponse.json({ error: 'Ürün bulunamadı.' }, { status: 404 })

  await prisma.product.update({ where: { id }, data: { status: 'unlisted' } })
  return NextResponse.json({ success: true })
}
