import { NextResponse } from 'next/server'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { createSellerRepository } from '@hanuja/api/repositories/seller.repository'
import { createCatalogService } from '@hanuja/api/services/catalog.service'

interface RouteContext {
  params: Promise<{ slug: string }>
}

export async function GET(request: Request, { params }: RouteContext) {
  const { slug } = await params
  const { searchParams } = new URL(request.url)
  const cursor = searchParams.get('cursor') ?? undefined
  const takeRaw = parseInt(searchParams.get('take') ?? '20', 10)
  const take = Number.isNaN(takeRaw) || takeRaw < 1 || takeRaw > 50 ? 20 : takeRaw

  const prisma = createPrismaForRoute()
  const sellerRepo = createSellerRepository(prisma)
  const catalogService = createCatalogService({ prisma })

  const seller = await sellerRepo.findBySlugWithProfile(slug)
  if (!seller) {
    return NextResponse.json({ error: 'Mağaza bulunamadı' }, { status: 404 })
  }

  const result = await catalogService.listPublishedWithCursor({
    sellerId: seller.id,
    take,
    ...(cursor ? { cursor } : {}),
  })

  const products = result.items.map((product) => ({
    id: product.id,
    title: product.name,
    slug: product.slug,
    price: Number(product.price),
    comparePrice: product.compareAtPrice ? Number(product.compareAtPrice) : null,
    imageUrl:
      (product.images as Array<{ url: string }> | undefined)?.[0]?.url ?? null,
    imageUrls: (
      (product.images as Array<{ url: string }> | undefined) ?? []
    ).map((image) => image.url),
    sellerName: seller.displayName ?? slug,
    sellerSlug: slug,
  }))

  return NextResponse.json({
    products,
    nextCursor: result.nextCursor,
    hasMore: result.hasMore,
  })
}
