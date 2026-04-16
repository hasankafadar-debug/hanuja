/**
 * POST /api/seller/products/[id]/images — ürüne görsel attach et.
 *
 * İstemciden gelen mediaAsset ID'lerini al, ProductImage kaydı oluştur.
 * FileUpload component R2'ye yüklediğinde mediaAsset oluşturulur;
 * bu endpoint ürün oluşturulduktan sonra görselleri product'a bağlar.
 */
import { headers } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }
const prisma = globalForPrisma.prisma ?? new PrismaClient()
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

const attachImagesSchema = z.object({
  // Array of confirmed mediaAsset IDs from FileUpload component
  mediaAssetIds: z.array(z.string()).min(1).max(10),
})

/** POST /api/seller/products/[id]/images */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: productId } = await params

  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return NextResponse.json({ error: 'Yetkisiz.' }, { status: 401 })
  }

  const seller = await prisma.seller.findUnique({ where: { userId: session.user.id } })
  if (!seller) {
    return NextResponse.json({ error: 'Satıcı hesabı bulunamadı.' }, { status: 404 })
  }

  // Ownership check — seller can only add images to their own products
  const product = await prisma.product.findUnique({
    where: { id: productId, sellerId: seller.id },
    select: { id: true },
  })
  if (!product) {
    return NextResponse.json({ error: 'Ürün bulunamadı veya erişim izniniz yok.' }, { status: 404 })
  }

  const body = await req.json().catch(() => ({}))
  const parsed = attachImagesSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0]?.message ?? 'Geçersiz veri.' },
      { status: 400 },
    )
  }

  // Verify all mediaAssets belong to this seller and are in 'ready' status
  const assets = await prisma.mediaAsset.findMany({
    where: {
      id: { in: parsed.data.mediaAssetIds },
      uploadedBy: session.user.id,
      status: 'ready',
    },
    select: { id: true, url: true },
  })

  if (assets.length === 0) {
    return NextResponse.json({ error: 'Geçerli görsel bulunamadı.' }, { status: 400 })
  }

  // Get current max sortOrder for this product
  const existing = await prisma.productImage.findMany({
    where: { productId },
    select: { sortOrder: true },
    orderBy: { sortOrder: 'desc' },
    take: 1,
  })
  const baseOrder = (existing[0]?.sortOrder ?? -1) + 1

  // Create ProductImage records
  const images = await prisma.$transaction(
    assets.map((asset, index) =>
      prisma.productImage.create({
        data: {
          productId,
          url: asset.url,
          sortOrder: baseOrder + index,
          isPrimary: baseOrder === 0 && index === 0, // First image is primary
        },
      }),
    ),
  )

  return NextResponse.json({ images }, { status: 201 })
}

/** GET /api/seller/products/[id]/images — ürünün görsellerini listele */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: productId } = await params

  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return NextResponse.json({ error: 'Yetkisiz.' }, { status: 401 })
  }

  const seller = await prisma.seller.findUnique({ where: { userId: session.user.id } })
  if (!seller) {
    return NextResponse.json({ error: 'Satıcı hesabı bulunamadı.' }, { status: 404 })
  }

  const product = await prisma.product.findUnique({
    where: { id: productId, sellerId: seller.id },
    select: { images: { orderBy: { sortOrder: 'asc' } } },
  })
  if (!product) {
    return NextResponse.json({ error: 'Ürün bulunamadı.' }, { status: 404 })
  }

  return NextResponse.json({ images: product.images })
}

/** DELETE /api/seller/products/[id]/images?imageId=xxx — görseli kaldır */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: productId } = await params
  const imageId = req.nextUrl.searchParams.get('imageId')

  if (!imageId) {
    return NextResponse.json({ error: 'imageId gerekli.' }, { status: 400 })
  }

  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return NextResponse.json({ error: 'Yetkisiz.' }, { status: 401 })
  }

  const seller = await prisma.seller.findUnique({ where: { userId: session.user.id } })
  if (!seller) {
    return NextResponse.json({ error: 'Satıcı hesabı bulunamadı.' }, { status: 404 })
  }

  // Ownership check via product
  const image = await prisma.productImage.findFirst({
    where: { id: imageId, productId, product: { sellerId: seller.id } },
  })
  if (!image) {
    return NextResponse.json({ error: 'Görsel bulunamadı veya erişim izniniz yok.' }, { status: 404 })
  }

  await prisma.productImage.delete({ where: { id: imageId } })

  return NextResponse.json({ ok: true })
}
