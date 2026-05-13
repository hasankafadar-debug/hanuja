import { headers } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { PrismaClient } from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/client'
import { z } from 'zod'
import { createCatalogService } from '@hanuja/api/services/catalog.service'
import { ConflictError, ValidationError } from '@hanuja/api/lib/errors'

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }
const prisma = globalForPrisma.prisma ?? new PrismaClient()
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

const variantSchema = z.object({
  id: z.string().uuid().optional(), // Mevcut varyantlarda DB ID — upsert için kullanılır
  color: z.string().trim().max(80).optional(),
  size: z.string().trim().max(80).optional(),
  customOptionName: z.string().trim().max(80).optional(),
  customOptionValue: z.string().trim().max(120).optional(),
  barcode: z.string().regex(/^\d{13}$/, 'Varyasyon barkodu 13 haneli rakam olmali'),
  price: z.number().positive('Varyasyon fiyati 0dan buyuk olmali'),
  stockQuantity: z.number().int().min(0, 'Varyasyon stoku negatif olamaz'),
})

const updateProductSchema = z.object({
  name: z.string().min(3).max(200).optional(),
  categoryId: z.string().min(1).nullable().optional(),
  description: z.string().max(5000).optional(),
  shortDescription: z.string().max(500).optional(),
  story: z.string().max(5000).optional(),
  careInstructions: z.string().max(5000).optional(),
  price: z.number().nonnegative().optional(),
  compareAtPrice: z.number().positive('Liste fiyati 0dan buyuk olmali').nullable().optional(),
  stockQuantity: z.number().int().min(0).optional(),
  sku: z.string().max(120).nullable().optional(),
  barcode: z.string().regex(/^\d{13}$/, 'Barkod 13 haneli rakam olmali').nullable().optional(),
  weight: z.number().positive().nullable().optional(),
  colorOptionId: z.string().min(1).optional(),
  materialOptionId: z.string().min(1).optional(),
  variants: z.array(variantSchema).max(100).optional(),
}).superRefine((data, ctx) => {
  if (data.variants && data.variants.length > 0 && data.barcode?.trim()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['barcode'], message: 'Varyasyonlu urunde ana barkod bos birakilmali.' })
  }
  if (data.variants && data.variants.length === 0 && data.barcode !== undefined && !data.barcode?.trim()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['barcode'], message: 'Varyasyonsuz urunde barkod zorunludur.' })
  }
})

type VariantInput = z.infer<typeof variantSchema>

function normalizeVariant(input: VariantInput) {
  const options: Record<string, string> = {}
  if (input.color?.trim()) options.Renk = input.color.trim()
  if (input.size?.trim()) options.Beden = input.size.trim()
  if (input.customOptionName?.trim() && input.customOptionValue?.trim()) {
    options[input.customOptionName.trim()] = input.customOptionValue.trim()
  }

  return {
    id: input.id,
    name: Object.entries(options).map(([key, value]) => `${key}: ${value}`).join(' / ') || input.barcode,
    options,
    barcode: input.barcode.trim(),
    price: new Decimal(input.price),
    stockQuantity: input.stockQuantity,
  }
}

async function getSellerOrFail() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return null
  return prisma.seller.findUnique({ where: { userId: session.user.id } })
}

async function assertVariantBarcodesAvailable(params: {
  productId: string
  barcodes: string[]
  productBarcode?: string | null
}) {
  const uniqueBarcodes = Array.from(new Set(params.barcodes))
  if (uniqueBarcodes.length !== params.barcodes.length) {
    throw new ConflictError('Ayni varyasyon barkodu birden fazla kez girilemez.')
  }

  if (params.productBarcode && uniqueBarcodes.includes(params.productBarcode)) {
    throw new ConflictError('Ana urun barkodu varyasyon barkodu ile ayni olamaz.')
  }

  if (uniqueBarcodes.length === 0) return

  const [productBarcode, variantBarcode] = await Promise.all([
    prisma.product.findFirst({
      where: { barcode: { in: uniqueBarcodes }, id: { not: params.productId } },
      select: { barcode: true },
    }),
    prisma.productVariant.findFirst({
      where: { barcode: { in: uniqueBarcodes }, productId: { not: params.productId } },
      select: { barcode: true },
    }),
  ])

  if (productBarcode || variantBarcode) {
    throw new ConflictError('Varyasyon barkodlarindan biri zaten kullaniliyor.')
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const seller = await getSellerOrFail()
  if (!seller) return NextResponse.json({ error: 'Yetkisiz.' }, { status: 401 })

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const parsed = updateProductSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Gecersiz veri.' },
      { status: 400 },
    )
  }

  try {
    const variants = parsed.data.variants?.map(normalizeVariant)
    if (variants) {
      await assertVariantBarcodesAvailable({
        productId: id,
        barcodes: variants.map((variant) => variant.barcode),
        productBarcode: parsed.data.barcode?.trim() || null,
      })
    }

    const updated = await prisma.$transaction(async (tx) => {
      const service = createCatalogService({ prisma: tx as unknown as PrismaClient })
      const saved = await service.updateProductForSeller({
        productId: id,
        sellerId: seller.id,
        ...(typeof parsed.data.name === 'string' && parsed.data.name.trim()
          ? { name: parsed.data.name.trim() }
          : {}),
        ...(parsed.data.categoryId !== undefined ? { categoryId: parsed.data.categoryId?.trim() || null } : {}),
        ...(typeof parsed.data.description === 'string' ? { description: parsed.data.description.trim() || null } : {}),
        ...(typeof parsed.data.shortDescription === 'string'
          ? { shortDescription: parsed.data.shortDescription.trim() || null }
          : {}),
        ...(typeof parsed.data.story === 'string' ? { story: parsed.data.story.trim() || null } : {}),
        ...(typeof parsed.data.careInstructions === 'string'
          ? { careInstructions: parsed.data.careInstructions.trim() || null }
          : {}),
        ...(typeof parsed.data.price === 'number' ? { price: new Decimal(parsed.data.price) } : {}),
        ...(parsed.data.compareAtPrice !== undefined
          ? { compareAtPrice: parsed.data.compareAtPrice !== null ? new Decimal(parsed.data.compareAtPrice) : null }
          : {}),
        ...(variants
          ? { stockQuantity: variants.reduce((sum, variant) => sum + variant.stockQuantity, 0) }
          : typeof parsed.data.stockQuantity === 'number'
            ? { stockQuantity: Math.floor(parsed.data.stockQuantity) }
            : {}),
        ...(parsed.data.sku !== undefined ? { sku: parsed.data.sku?.trim() || null } : {}),
        ...(variants
          ? { barcode: variants.length > 0 ? null : parsed.data.barcode?.trim() || null }
          : parsed.data.barcode !== undefined
            ? { barcode: parsed.data.barcode?.trim() || null }
            : {}),
        ...(parsed.data.weight !== undefined
          ? { weight: parsed.data.weight !== null ? new Decimal(parsed.data.weight) : null }
          : {}),
      })

      if (variants) {
        // Gelen ID'leri koru (upsert), listede olmayan eski varyantları sil
        const incomingIds = variants.filter((v) => v.id).map((v) => v.id as string)
        await tx.productVariant.deleteMany({
          where: { productId: id, id: { notIn: incomingIds } },
        })
        for (const variant of variants) {
          if (variant.id) {
            await tx.productVariant.update({
              where: { id: variant.id },
              data: {
                name: variant.name,
                options: variant.options,
                barcode: variant.barcode,
                price: variant.price,
                stockQuantity: variant.stockQuantity,
              },
            })
          } else {
            await tx.productVariant.create({
              data: {
                productId: id,
                name: variant.name,
                options: variant.options,
                barcode: variant.barcode,
                price: variant.price,
                stockQuantity: variant.stockQuantity,
              },
            })
          }
        }
      }

      // Update attribute values when provided
      const { colorOptionId, materialOptionId } = parsed.data
      if (colorOptionId) {
        await tx.productAttributeValue.deleteMany({
          where: {
            productId: id,
            option: { type: 'color' },
          },
        })
        await tx.productAttributeValue.create({
          data: { productId: id, optionId: colorOptionId },
        })
      }
      if (materialOptionId) {
        await tx.productAttributeValue.deleteMany({
          where: {
            productId: id,
            option: { type: 'material' },
          },
        })
        await tx.productAttributeValue.create({
          data: { productId: id, optionId: materialOptionId },
        })
      }

      return saved
    })

    return NextResponse.json({
      product: {
        id: updated.id,
        name: updated.name,
        status: updated.status,
      },
    })
  } catch (error) {
    if (error instanceof ConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    if (error instanceof Error && error.message.startsWith('Product')) {
      return NextResponse.json({ error: 'Urun bulunamadi.' }, { status: 404 })
    }
    throw error
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const seller = await getSellerOrFail()
  if (!seller) return NextResponse.json({ error: 'Yetkisiz.' }, { status: 401 })

  const { id } = await params
  const permanent = req.nextUrl.searchParams.get('permanent') === 'true'

  const product = await prisma.product.findFirst({ where: { id, sellerId: seller.id } })
  if (!product) return NextResponse.json({ error: 'Urun bulunamadi.' }, { status: 404 })

  if (permanent) {
    const hasOrders = await prisma.orderLine.findFirst({ where: { productId: id } })
    if (hasOrders) {
      return NextResponse.json(
        { error: 'Bu ürüne ait siparişler var. Kalıcı silinemez, yayından kaldırabilirsiniz.' },
        { status: 409 },
      )
    }
    await prisma.product.delete({ where: { id } })
  } else {
    await prisma.product.update({ where: { id }, data: { status: 'unlisted' } })
  }

  return NextResponse.json({ success: true })
}
