import { headers } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { checkUserRateLimit, SENSITIVE_RATE_LIMIT } from '@hanuja/api/lib/rate-limit'
import { createProductImportService, type CommitSelection } from '@hanuja/api/services/product-import/import.service'
import type { ScrapedProduct } from '@hanuja/api/services/product-import/adapters/import-adapter'
import { normalizeImportBarcode } from '@hanuja/api/services/product-import/barcode'

function isScrapedProduct(value: unknown): value is ScrapedProduct {
  if (!value || typeof value !== 'object') return false

  const candidate = value as Record<string, unknown>

  return (
    typeof candidate.externalId === 'string' &&
    typeof candidate.name === 'string' &&
    typeof candidate.price === 'number' &&
    Array.isArray(candidate.imageUrls) &&
    candidate.imageUrls.every((imageUrl) => typeof imageUrl === 'string') &&
    typeof candidate.externalUrl === 'string'
  )
}

interface RawSelection {
  externalId: string
  categoryId?: string | null
  autoCreateUnder?: { parentId: string; leafName: string } | null
  colorOptionId?: string | null
  materialOptionId?: string | null
  barcode?: string | null
  fulfillmentDays?: number | null
  stockQuantity?: number | null
}

function isRawSelection(value: unknown): value is RawSelection {
  if (!value || typeof value !== 'object') return false
  const c = value as Record<string, unknown>
  if (typeof c.externalId !== 'string') return false

  const hasCategoryId = typeof c.categoryId === 'string' && c.categoryId.trim().length > 0
  const hasAutoCreate =
    c.autoCreateUnder !== null &&
    c.autoCreateUnder !== undefined &&
    typeof c.autoCreateUnder === 'object' &&
    typeof (c.autoCreateUnder as Record<string, unknown>).parentId === 'string' &&
    typeof (c.autoCreateUnder as Record<string, unknown>).leafName === 'string'

  const hasValidStock =
    typeof c.stockQuantity === 'number' &&
    Number.isInteger(c.stockQuantity) &&
    c.stockQuantity >= 0
  const hasValidFulfillmentDays =
    typeof c.fulfillmentDays === 'number' &&
    Number.isInteger(c.fulfillmentDays) &&
    c.fulfillmentDays >= 1
  const hasColorOptionId = typeof c.colorOptionId === 'string' && c.colorOptionId.trim().length > 0
  const hasMaterialOptionId =
    typeof c.materialOptionId === 'string' && c.materialOptionId.trim().length > 0

  return (hasCategoryId || hasAutoCreate) && hasValidStock && hasValidFulfillmentDays && hasColorOptionId && hasMaterialOptionId
}

const SAFE_LEAF_NAME_RE = /^[^./\\<>:"|?*\x00-\x1f]{1,80}$/

export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return NextResponse.json({ error: 'Yetkisiz.' }, { status: 401 })
  }

  // Toplu ürün yazma maliyetli — istek hızını sınırla
  const rl = await checkUserRateLimit(session.user.id, 'products:import-commit', SENSITIVE_RATE_LIMIT)
  if (!rl.allowed) return rl.response!

  const prisma = createPrismaForRoute()
  const seller = await prisma.seller.findUnique({
    where: { userId: session.user.id },
    select: {
      id: true,
      status: true,
      sellerNumber: true,
      userId: true,
      importEnabled: true,
    },
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

  const body = (await req.json().catch(() => ({}))) as {
    adapter?: unknown
    externalUrl?: unknown
    items?: unknown
    selections?: unknown
  }

  const adapter = typeof body.adapter === 'string' ? body.adapter.trim() : ''
  const externalUrl = typeof body.externalUrl === 'string' ? body.externalUrl.trim() : ''
  const items = Array.isArray(body.items) ? body.items.filter(isScrapedProduct) : []
  const rawSelections = Array.isArray(body.selections)
    ? body.selections.filter(isRawSelection)
    : []

  if (!adapter || !externalUrl) {
    return NextResponse.json({ error: 'Adapter ve kaynak URL zorunludur.' }, { status: 400 })
  }

  if (!Array.isArray(body.items) || items.length !== body.items.length) {
    return NextResponse.json({ error: 'Ürün listesi geçersiz.' }, { status: 400 })
  }

  if (!Array.isArray(body.selections) || rawSelections.length !== body.selections.length) {
    return NextResponse.json({ error: 'Seçim listesi geçersiz.' }, { status: 400 })
  }

  if (rawSelections.length === 0) {
    return NextResponse.json({ error: 'En az bir ürün seçilmelidir.' }, { status: 400 })
  }

  // Validate autoCreateUnder leaf names and parent existence
  for (const raw of rawSelections) {
    if (raw.autoCreateUnder) {
      const { parentId, leafName } = raw.autoCreateUnder
      if (!parentId?.trim() || !leafName?.trim()) {
        return NextResponse.json({ error: 'autoCreateUnder alanları geçersiz.' }, { status: 400 })
      }
      if (!SAFE_LEAF_NAME_RE.test(leafName.trim())) {
        return NextResponse.json(
          { error: `Geçersiz kategori adı: "${leafName}"` },
          { status: 400 },
        )
      }
      const parentExists = await prisma.category.findFirst({
        where: { id: parentId.trim(), isActive: true },
        select: { id: true },
      })
      if (!parentExists) {
        return NextResponse.json(
          { error: `Üst kategori bulunamadı: ${parentId}` },
          { status: 400 },
        )
      }
    }
  }

  // Validate barcode for non-variant products
  const itemVariantMap = new Map(items.map((item) => [item.externalId, (item.variants?.length ?? 0) > 0]))

  for (const raw of rawSelections) {
    const hasVariants = itemVariantMap.get(raw.externalId) ?? false
    if (!hasVariants) {
      const barcodeVal = raw.barcode?.trim() || ''
      if (!barcodeVal) {
        return NextResponse.json(
          { error: `Barkod zorunludur: ${raw.externalId}` },
          { status: 400 },
        )
      }
      const normalized = normalizeImportBarcode(barcodeVal, seller.sellerNumber)
      if (!normalized) {
        return NextResponse.json(
          { error: `Geçersiz barkod: "${barcodeVal}"` },
          { status: 400 },
        )
      }
    }
  }

  const itemIds = new Set(items.map((item) => item.externalId))
  if (rawSelections.some((raw) => !itemIds.has(raw.externalId))) {
    return NextResponse.json(
      { error: 'Seçimler önizleme sonucundaki ürünlerle eşleşmiyor.' },
      { status: 400 },
    )
  }

  const selections: CommitSelection[] = rawSelections.map((raw) => {
    if (raw.categoryId?.trim()) {
      return {
        externalId: raw.externalId.trim(),
        categoryId: raw.categoryId.trim(),
        colorOptionId: raw.colorOptionId!.trim(),
        materialOptionId: raw.materialOptionId!.trim(),
        // isRawSelection guard'ı >= 1 garantiler; sessiz varsayılan yok
        fulfillmentDays: raw.fulfillmentDays!,
        stockQuantity: raw.stockQuantity ?? 0,
        barcode:
          typeof raw.barcode === 'string' ? raw.barcode.trim() || null : (raw.barcode ?? null),
      }
    }
    return {
      externalId: raw.externalId.trim(),
      autoCreateUnder: {
        parentId: raw.autoCreateUnder!.parentId.trim(),
        leafName: raw.autoCreateUnder!.leafName.trim(),
      },
      colorOptionId: raw.colorOptionId!.trim(),
      materialOptionId: raw.materialOptionId!.trim(),
      // isRawSelection guard'ı >= 1 garantiler; sessiz varsayılan yok
      fulfillmentDays: raw.fulfillmentDays!,
      stockQuantity: raw.stockQuantity ?? 0,
      barcode:
        typeof raw.barcode === 'string' ? raw.barcode.trim() || null : (raw.barcode ?? null),
    }
  })

  try {
    const service = createProductImportService({ prisma })
    const resolvedAdapter = service.resolveAdapter(externalUrl)

    if (resolvedAdapter.name !== adapter) {
      return NextResponse.json({ error: 'Adapter ve kaynak URL eşleşmiyor.' }, { status: 400 })
    }

    const createdProducts = await service.commit({
      sellerId: seller.id,
      sellerNumber: seller.sellerNumber,
      ownerId: seller.userId,
      items,
      selections,
    })

    return NextResponse.json({
      importedCount: createdProducts.length,
      selectedCount: selections.length,
      items: createdProducts,
    })
  } catch (error) {
    console.error('[import/commit] error:', error)
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Ürünler içe aktarılamadı.',
      },
      { status: 400 },
    )
  }
}
