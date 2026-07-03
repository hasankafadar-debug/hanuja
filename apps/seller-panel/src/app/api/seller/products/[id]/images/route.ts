import { headers } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }
const prisma = globalForPrisma.prisma ?? new PrismaClient()
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

const attachImagesSchema = z.object({
  mediaAssetIds: z.array(z.string()).min(1).max(10),
})

const setPrimaryImageSchema = z.object({
  primaryImageId: z.string().min(1),
})

async function getSeller() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return { session: null, seller: null }
  const seller = await prisma.seller.findUnique({ where: { userId: session.user.id } })
  return { session, seller }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: productId } = await params
  const { session, seller } = await getSeller()
  if (!session?.user) return NextResponse.json({ error: 'Yetkisiz.' }, { status: 401 })
  if (!seller) return NextResponse.json({ error: 'Satici hesabi bulunamadi.' }, { status: 404 })

  const product = await prisma.product.findFirst({
    where: { id: productId, sellerId: seller.id },
    select: { id: true },
  })
  if (!product) {
    return NextResponse.json({ error: 'Urun bulunamadi veya erisim izniniz yok.' }, { status: 404 })
  }

  const body = await req.json().catch(() => ({}))
  const parsed = attachImagesSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0]?.message ?? 'Gecersiz veri.' },
      { status: 400 },
    )
  }

  const assets = await prisma.mediaAsset.findMany({
    where: {
      id: { in: parsed.data.mediaAssetIds },
      uploadedBy: session.user.id,
      status: 'ready',
    },
    select: { id: true, url: true },
  })

  if (assets.length === 0) {
    return NextResponse.json({ error: 'Gecerli gorsel bulunamadi.' }, { status: 400 })
  }

  if (assets.length !== parsed.data.mediaAssetIds.length) {
    return NextResponse.json(
      {
        error: 'Bazi gorseller henuz hazir degil veya urune baglanamadi. Lutfen yuklemelerin tamamlanmasini bekleyip tekrar deneyin.',
      },
      { status: 409 },
    )
  }

  const existing = await prisma.productImage.findMany({
    where: { productId },
    select: { sortOrder: true },
    orderBy: { sortOrder: 'desc' },
    take: 1,
  })
  const baseOrder = (existing[0]?.sortOrder ?? -1) + 1

  const images = await prisma.$transaction(
    assets.map((asset, index) =>
      prisma.productImage.create({
        data: {
          productId,
          url: asset.url,
          sortOrder: baseOrder + index,
          isPrimary: baseOrder === 0 && index === 0,
        },
      }),
    ),
  )

  return NextResponse.json({ images }, { status: 201 })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: productId } = await params
  const { session, seller } = await getSeller()
  if (!session?.user) return NextResponse.json({ error: 'Yetkisiz.' }, { status: 401 })
  if (!seller) return NextResponse.json({ error: 'Satici hesabi bulunamadi.' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const parsed = setPrimaryImageSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0]?.message ?? 'Gecersiz veri.' },
      { status: 400 },
    )
  }

  const image = await prisma.productImage.findFirst({
    where: { id: parsed.data.primaryImageId, productId, product: { sellerId: seller.id } },
    select: { id: true },
  })
  if (!image) {
    return NextResponse.json({ error: 'Gorsel bulunamadi veya erisim izniniz yok.' }, { status: 404 })
  }

  await prisma.$transaction([
    prisma.productImage.updateMany({ where: { productId }, data: { isPrimary: false } }),
    prisma.productImage.update({ where: { id: image.id }, data: { isPrimary: true } }),
  ])

  return NextResponse.json({ ok: true })
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: productId } = await params
  const { session, seller } = await getSeller()
  if (!session?.user) return NextResponse.json({ error: 'Yetkisiz.' }, { status: 401 })
  if (!seller) return NextResponse.json({ error: 'Satici hesabi bulunamadi.' }, { status: 404 })

  const product = await prisma.product.findFirst({
    where: { id: productId, sellerId: seller.id },
    select: { images: { orderBy: { sortOrder: 'asc' } } },
  })
  if (!product) return NextResponse.json({ error: 'Urun bulunamadi.' }, { status: 404 })

  return NextResponse.json({ images: product.images })
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: productId } = await params
  const imageId = req.nextUrl.searchParams.get('imageId')

  if (!imageId) {
    return NextResponse.json({ error: 'imageId gerekli.' }, { status: 400 })
  }

  const { session, seller } = await getSeller()
  if (!session?.user) return NextResponse.json({ error: 'Yetkisiz.' }, { status: 401 })
  if (!seller) return NextResponse.json({ error: 'Satici hesabi bulunamadi.' }, { status: 404 })

  const image = await prisma.productImage.findFirst({
    where: { id: imageId, productId, product: { sellerId: seller.id } },
  })
  if (!image) {
    return NextResponse.json({ error: 'Gorsel bulunamadi veya erisim izniniz yok.' }, { status: 404 })
  }

  await prisma.productImage.delete({ where: { id: imageId } })

  return NextResponse.json({ ok: true })
}
