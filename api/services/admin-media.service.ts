import type { MediaAssetKind, PrismaClient } from '@prisma/client'

export type AdminMediaSource = 'admin' | 'seller-products'

export interface AdminMediaListOptions {
  source: AdminMediaSource
  page: number
  pageSize: number
  kind?: MediaAssetKind
  folder?: string
  search?: string
}

const assetSelect = {
  id: true,
  kind: true,
  url: true,
  folder: true,
  originalName: true,
  mimeType: true,
  sizeBytes: true,
  width: true,
  height: true,
  durationSec: true,
  variants: true,
  status: true,
  createdAt: true,
} as const

function normalized(value: string | null | undefined) {
  return value?.toLocaleLowerCase('tr-TR') ?? ''
}

export async function listAdminMedia(
  prisma: PrismaClient,
  adminUserId: string,
  options: AdminMediaListOptions,
) {
  if (options.source === 'admin') {
    const where = {
      uploadedBy: adminUserId,
      status: 'ready',
      ...(options.kind ? { kind: options.kind } : {}),
      ...(options.folder && options.folder !== 'all' ? { folder: options.folder } : {}),
      ...(options.search
        ? {
            originalName: {
              contains: options.search,
              mode: 'insensitive' as const,
            },
          }
        : {}),
    }

    const [assets, total] = await Promise.all([
      prisma.mediaAsset.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (options.page - 1) * options.pageSize,
        take: options.pageSize,
        select: assetSelect,
      }),
      prisma.mediaAsset.count({ where }),
    ])

    return {
      assets: assets.map((asset) => ({ ...asset, source: 'admin' as const })),
      total,
      page: options.page,
      totalPages: Math.ceil(total / options.pageSize),
    }
  }

  const productImages = await prisma.productImage.findMany({
    where: {
      product: {
        status: 'published',
      },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: {
      url: true,
      product: {
        select: {
          id: true,
          name: true,
          modelCode: true,
          seller: {
            select: {
              id: true,
              userId: true,
              displayName: true,
            },
          },
        },
      },
    },
  })

  const productRefsByUrl = new Map<string, typeof productImages>()
  for (const image of productImages) {
    const refs = productRefsByUrl.get(image.url)
    if (refs) {
      refs.push(image)
    } else {
      productRefsByUrl.set(image.url, [image])
    }
  }

  const urls = [...productRefsByUrl.keys()]
  if (urls.length === 0) {
    return { assets: [], total: 0, page: options.page, totalPages: 0 }
  }

  const candidates = await prisma.mediaAsset.findMany({
    where: {
      url: { in: urls },
      folder: 'products',
      kind: 'image',
      status: 'ready',
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: {
      ...assetSelect,
      uploadedBy: true,
    },
  })

  const search = normalized(options.search?.trim())
  const matchingAssets = candidates.flatMap((candidate) => {
    const productRef = productRefsByUrl
      .get(candidate.url)
      ?.find((ref) => ref.product.seller.userId === candidate.uploadedBy)

    if (!productRef) return []

    const product = {
      id: productRef.product.id,
      name: productRef.product.name,
      modelCode: productRef.product.modelCode,
    }
    const seller = {
      id: productRef.product.seller.id,
      displayName: productRef.product.seller.displayName,
    }

    if (
      search &&
      ![candidate.originalName, product.name, product.modelCode, seller.displayName].some((value) =>
        normalized(value).includes(search),
      )
    ) {
      return []
    }

    const { uploadedBy: _uploadedBy, ...asset } = candidate
    return [{ ...asset, source: 'seller-products' as const, product, seller }]
  })

  const total = matchingAssets.length
  const start = (options.page - 1) * options.pageSize

  return {
    assets: matchingAssets.slice(start, start + options.pageSize),
    total,
    page: options.page,
    totalPages: Math.ceil(total / options.pageSize),
  }
}
