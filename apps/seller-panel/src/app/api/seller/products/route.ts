import { headers } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { Decimal } from '@prisma/client/runtime/client'
import { auth } from '@/lib/auth'
import { PrismaClient } from '@prisma/client'
import { createCatalogService } from '@hanuja/api/services/catalog.service'
import { ConflictError, ValidationError } from '@hanuja/api/lib/errors'

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }
const prisma = globalForPrisma.prisma ?? new PrismaClient()
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

const variantSchema = z.object({
  color: z.string().trim().max(80).optional(),
  material: z.string().trim().max(80).optional(),
  size: z.string().trim().max(80).optional(),
  customOptionName: z.string().trim().max(80).optional(),
  customOptionValue: z.string().trim().max(120).optional(),
  barcode: z.string().regex(/^\d{13}$/, 'Varyasyon barkodu 13 haneli rakam olmali'),
  price: z.number().positive('Varyasyon fiyati 0dan buyuk olmali'),
  stockQuantity: z.number().int().min(0, 'Varyasyon stoku negatif olamaz'),
})

const createProductSchema = z.object({
  name: z.string().min(3, 'Urun adi en az 3 karakter olmali').max(200),
  categoryId: z.string().min(1, 'Kategori secimi zorunludur'),
  price: z.number().positive('Fiyat 0dan buyuk olmali'),
  fulfillmentDays: z.number().int().min(1, 'Sevk suresi en az 1 is gunu olmali').max(90, 'Sevk suresi en fazla 90 is gunu olabilir'),
  stockQuantity: z.number().int().min(0, 'Stok negatif olamaz'),
  barcode: z.string().regex(/^\d{13}$/, 'Barkod 13 haneli rakam olmali').nullable().optional(),
  shortDescription: z.string().max(500).optional(),
  description: z.string().max(5000).optional().default(''),
  story: z.string().max(5000).optional(),
  careInstructions: z.string().max(5000).optional(),
  compareAtPrice: z.number().positive('Liste fiyati 0dan buyuk olmali').optional(),
  sku: z.string().max(120).optional(),
  weight: z.number().positive('Agirlik 0dan buyuk olmali').optional(),
  colorOptionId: z.string().min(1, 'Renk secimi zorunludur'),
  materialOptionId: z.string().min(1, 'Materyal secimi zorunludur'),
  variants: z.array(variantSchema).max(100).optional().default([]),
}).superRefine((data, ctx) => {
  if (data.variants.length === 0 && !data.barcode?.trim()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['barcode'], message: 'Barkod 13 haneli rakam olmali' })
  }
})

type VariantInput = z.infer<typeof variantSchema>

function normalizeVariant(input: VariantInput) {
  const options: Record<string, string> = {}
  if (input.size?.trim()) options.Beden = input.size.trim()
  if (input.customOptionName?.trim() && input.customOptionValue?.trim()) {
    options[input.customOptionName.trim()] = input.customOptionValue.trim()
  }

  return {
    name: Object.entries(options).map(([key, value]) => `${key}: ${value}`).join(' / ') || input.barcode,
    options,
    barcode: input.barcode.trim(),
    price: new Decimal(input.price),
    stockQuantity: input.stockQuantity,
  }
}

async function assertVariantBarcodesAvailable(params: {
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
    prisma.product.findFirst({ where: { barcode: { in: uniqueBarcodes } }, select: { barcode: true } }),
    prisma.productVariant.findFirst({ where: { barcode: { in: uniqueBarcodes } }, select: { barcode: true } }),
  ])

  if (productBarcode || variantBarcode) {
    throw new ConflictError('Varyasyon barkodlarindan biri zaten kullaniliyor.')
  }
}

/** POST /api/seller/products - yeni urun ekle */
export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return NextResponse.json({ error: 'Yetkisiz.' }, { status: 401 })
  }

  const seller = await prisma.seller.findUnique({ where: { userId: session.user.id } })
  if (!seller) {
    return NextResponse.json({ error: 'Satici hesabi bulunamadi.' }, { status: 404 })
  }

  if (seller.status !== 'active') {
    return NextResponse.json({ error: 'Urun eklemek icin satici hesabiniz aktif olmali.' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const parsed = createProductSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message ?? 'Gecersiz veri.' }, { status: 400 })
  }

  if (parsed.data.compareAtPrice !== undefined && parsed.data.compareAtPrice <= parsed.data.price) {
    return NextResponse.json(
      { error: 'Liste fiyati satis fiyatindan buyuk olmalidir.' },
      { status: 400 },
    )
  }

  try {
    const variants = parsed.data.variants.map(normalizeVariant)
    await assertVariantBarcodesAvailable({
      barcodes: variants.map((variant) => variant.barcode),
      productBarcode: parsed.data.barcode?.trim() || null,
    })

    const product = await prisma.$transaction(async (tx) => {
      const svc = createCatalogService({ prisma: tx as unknown as PrismaClient })
      const created = await svc.createProduct({
        sellerId: seller.id,
        categoryId: parsed.data.categoryId,
        name: parsed.data.name,
        description: parsed.data.description ?? '',
        shortDescription: parsed.data.shortDescription?.trim() || null,
        story: parsed.data.story?.trim() || null,
        careInstructions: parsed.data.careInstructions?.trim() || null,
        price: new Decimal(parsed.data.price),
        compareAtPrice:
          parsed.data.compareAtPrice !== undefined ? new Decimal(parsed.data.compareAtPrice) : null,
        fulfillmentDays: parsed.data.fulfillmentDays,
        stockQuantity:
          variants.length > 0
            ? variants.reduce((sum, variant) => sum + variant.stockQuantity, 0)
            : parsed.data.stockQuantity,
        sku: parsed.data.sku?.trim() || null,
        barcode: variants.length > 0 ? null : parsed.data.barcode?.trim() || null,
        weight: parsed.data.weight !== undefined ? new Decimal(parsed.data.weight) : null,
      })

      if (variants.length > 0) {
        await tx.productVariant.createMany({
          data: variants.map((variant) => ({
            productId: created.id,
            name: variant.name,
            options: variant.options,
            barcode: variant.barcode,
            price: variant.price,
            stockQuantity: variant.stockQuantity,
          })),
        })
      }

      await tx.productAttributeValue.createMany({
        data: [
          { productId: created.id, optionId: parsed.data.colorOptionId },
          { productId: created.id, optionId: parsed.data.materialOptionId },
        ],
        skipDuplicates: true,
      })

      return created
    })

    return NextResponse.json({ productId: product.id }, { status: 201 })
  } catch (error) {
    if (error instanceof ConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    throw error
  }
}
