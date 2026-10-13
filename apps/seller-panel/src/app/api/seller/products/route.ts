import { validateVariantDescriptor } from '@hanuja/api/services/category-schema.service'
import { headers } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { Decimal } from '@prisma/client/runtime/client'
import { auth } from '@/lib/auth'
import { PrismaClient } from '@prisma/client'
import { createCatalogService } from '@hanuja/api/services/catalog.service'
import { recordPriceChanges } from '@hanuja/api/services/price-history.service'
import { ConflictError, ValidationError } from '@hanuja/api/lib/errors'
import {
  isBarcodeConflict,
  syncVariantBarcodeReservation,
} from '@hanuja/api/domain/barcode-registry'
import { generateUniqueProductBarcode } from '@hanuja/api/domain/barcode-generate'
import { requireModelCode } from '@hanuja/api/domain/model-code'
import {
  resolveCategorySchema,
  validateSharedAttributes,
  normalizedVariantProperties,
} from '@hanuja/api/services/category-schema.service'
import { propertyLabel, variantPropertyKey } from '@hanuja/api/domain/category-schema'
import { enqueueProductSync } from '@hanuja/api/jobs/search-index-sync.job'

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }
const prisma = globalForPrisma.prisma ?? new PrismaClient()
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

const variantSchema = z.object({
  color: z
    .never({
      invalid_type_error: 'Varyant rengi desteklenmiyor; her rengi ayrı ürün olarak yükleyin.',
    })
    .optional(),
  material: z
    .never({ invalid_type_error: 'Varyant materyali desteklenmiyor; ayrı ürün olarak yükleyin.' })
    .optional(),
  properties: z
    .record(z.union([z.string(), z.number(), z.boolean(), z.null()]))
    .optional()
    .default({}),
  size: z.string().trim().max(80).optional(),
  customOptionName: z.string().trim().max(80).optional(),
  customOptionValue: z.string().trim().max(120).optional(),
  // Optional: blank barcodes are auto-generated ("8"-prefixed EAN-13) at creation.
  barcode: z
    .string()
    .trim()
    .refine(
      (value) => value === '' || /^\d{13}$/.test(value),
      'Varyasyon barkodu 13 haneli rakam olmali',
    )
    .optional(),
  price: z.number().positive('Varyasyon fiyati 0dan buyuk olmali'),
  stockQuantity: z.number().int().min(0, 'Varyasyon stoku negatif olamaz'),
})

const createProductSchema = z
  .object({
    name: z.string().min(3, 'Urun adi en az 3 karakter olmali').max(200),
    categoryId: z.string().min(1, 'Kategori secimi zorunludur'),
    price: z.number().positive('Fiyat 0dan buyuk olmali'),
    fulfillmentDays: z
      .number()
      .int()
      .min(1, 'Sevk suresi en az 1 is gunu olmali')
      .max(90, 'Sevk suresi en fazla 90 is gunu olabilir'),
    stockQuantity: z.number().int().min(0, 'Stok negatif olamaz'),
    barcode: z
      .string()
      .trim()
      .refine((value) => value === '' || /^\d{13}$/.test(value), 'Barkod 13 haneli rakam olmali')
      .nullable()
      .optional(),
    shortDescription: z.string().max(500).optional(),
    description: z.string().max(5000).optional().default(''),
    story: z.string().max(5000).optional(),
    careInstructions: z.string().max(5000).optional(),
    compareAtPrice: z.number().positive('Liste fiyati 0dan buyuk olmali').optional(),
    sku: z.string().max(120).optional(),
    modelCode: z.string().min(1, 'Model Kodu zorunludur').max(120),
    weight: z.number().positive('Agirlik 0dan buyuk olmali').optional(),
    // Boyutlar (cm) — opsiyonel: En → dimensionWidth, Boy → dimensionLength, Yukseklik → dimensionHeight.
    dimensionLength: z.number().positive('Boy 0dan buyuk olmali').optional(),
    dimensionWidth: z.number().positive('En 0dan buyuk olmali').optional(),
    dimensionHeight: z.number().positive('Yukseklik 0dan buyuk olmali').optional(),
    colorOptionId: z.string().min(1).nullable().optional(),
    // Renk 2 (opsiyonel): ürün iki renkliyse ikinci renk. Renk 1'den farklı olmalı.
    secondColorOptionId: z.string().min(1).optional(),
    materialOptionId: z.string().min(1).nullable().optional(),
    variants: z.array(variantSchema).max(100).optional().default([]),
    properties: z
      .record(z.union([z.string(), z.number(), z.boolean(), z.null()]))
      .optional()
      .default({}),
    contentUnit: z.enum(['ml', 'g', 'adet']).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.secondColorOptionId && !data.colorOptionId)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['secondColorOptionId'],
        message: 'Ikinci renk icin birinci renk secilmelidir.',
      })
    if (data.secondColorOptionId && data.secondColorOptionId === data.colorOptionId)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['secondColorOptionId'],
        message: 'Ikinci renk birinci renkten farkli olmalidir.',
      })
  })

type VariantInput = z.infer<typeof variantSchema>

function normalizeVariant(input: VariantInput) {
  validateVariantDescriptor(input.customOptionName)
  const options: Record<string, string> = {}
  if (input.size?.trim()) options.Beden = input.size.trim()
  if (input.customOptionName?.trim() && input.customOptionValue?.trim()) {
    options[input.customOptionName.trim()] = input.customOptionValue.trim()
  }

  return {
    properties: input.properties,
    // Barcode may be blank (auto-generated later); the final name falls back to
    // the resolved barcode at creation time.
    name: Object.entries(options)
      .map(([key, value]) => `${key}: ${value}`)
      .join(' / '),
    options,
    barcode: input.barcode?.trim() ?? '',
    price: new Decimal(input.price),
    stockQuantity: input.stockQuantity,
  }
}

async function assertVariantBarcodesAvailable(params: {
  barcodes: string[]
  productBarcode?: string | null
}) {
  // Only seller-entered barcodes are checked; blanks are auto-generated later.
  const enteredBarcodes = params.barcodes.map((barcode) => barcode.trim()).filter(Boolean)
  const uniqueBarcodes = Array.from(new Set(enteredBarcodes))
  if (uniqueBarcodes.length !== enteredBarcodes.length) {
    throw new ConflictError('Ayni varyasyon barkodu birden fazla kez girilemez.')
  }

  if (params.productBarcode && uniqueBarcodes.includes(params.productBarcode)) {
    throw new ConflictError('Ana urun barkodu varyasyon barkodu ile ayni olamaz.')
  }

  if (uniqueBarcodes.length === 0) return

  const [productBarcode, variantBarcode] = await Promise.all([
    prisma.barcodeRegistry.findFirst({
      where: { barcode: { in: uniqueBarcodes } },
      select: { barcode: true },
    }),
    prisma.productVariant.findFirst({
      where: { barcode: { in: uniqueBarcodes } },
      select: { barcode: true },
    }),
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
    return NextResponse.json({ error: 'Tasarımcı hesabi bulunamadi.' }, { status: 404 })
  }

  if (seller.status !== 'active') {
    return NextResponse.json(
      { error: 'Urun eklemek icin tasarımcı hesabiniz aktif olmali.' },
      { status: 403 },
    )
  }

  const body = await req.json().catch(() => ({}))
  const parsed = createProductSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0]?.message ?? 'Gecersiz veri.' },
      { status: 400 },
    )
  }

  if (parsed.data.compareAtPrice !== undefined && parsed.data.compareAtPrice <= parsed.data.price) {
    return NextResponse.json(
      { error: 'Liste fiyati satis fiyatindan buyuk olmalidir.' },
      { status: 400 },
    )
  }

  if (
    parsed.data.secondColorOptionId !== undefined &&
    parsed.data.secondColorOptionId === parsed.data.colorOptionId
  ) {
    return NextResponse.json(
      { error: 'Ikinci renk birinci renkten farkli olmalidir.' },
      { status: 400 },
    )
  }

  try {
    const schema = await resolveCategorySchema(prisma, parsed.data.categoryId)
    const variants = parsed.data.variants.map((input) => {
      const variant = normalizeVariant(input)
      const key = variantPropertyKey(schema, parsed.data.contentUnit)
      validateVariantDescriptor(input.customOptionName, schema.config.variantLabel ?? undefined)
      const raw = { ...input.properties }
      if (key && raw[key] === undefined && input.size) raw[key] = input.size
      const properties = normalizedVariantProperties(
        schema,
        raw,
        parsed.data.properties,
        parsed.data.contentUnit,
      )
      const definition = schema.definitions.find((f) => f.key === key)
      if (definition && key) {
        delete variant.options.Beden
        variant.options[schema.config.variantLabel ?? definition.label] = propertyLabel(
          definition,
          properties[key] ?? null,
        )
      }
      return {
        ...variant,
        properties,
        name: Object.entries(variant.options)
          .map(([k, v]) => `${k}: ${v}`)
          .join(' / '),
      }
    })
    await assertVariantBarcodesAvailable({
      barcodes: variants.map((variant) => variant.barcode),
      productBarcode: parsed.data.barcode?.trim() || null,
    })

    // Seeded with entered variant barcodes so generated ones cannot collide
    // with a still-pending entered barcode in the same request.
    const usedBarcodes = new Set<string>(variants.map((variant) => variant.barcode).filter(Boolean))

    const product = await prisma.$transaction(async (tx) => {
      const current = await resolveCategorySchema(tx, parsed.data.categoryId)
      await validateSharedAttributes(tx, current, parsed.data)
      for (const [index, variant] of variants.entries()) {
        const input = parsed.data.variants[index]!
        const key = variantPropertyKey(current, parsed.data.contentUnit)
        validateVariantDescriptor(input.customOptionName, current.config.variantLabel ?? undefined)
        const raw = { ...input.properties }
        if (key && raw[key] === undefined && input.size) raw[key] = input.size
        variant.properties = normalizedVariantProperties(
          current,
          raw,
          parsed.data.properties,
          parsed.data.contentUnit,
        )
      }
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
        modelCode: requireModelCode(parsed.data.modelCode),
        barcode: variants.length > 0 ? null : parsed.data.barcode?.trim() || null,
        autoGenerateBarcodeWhenMissing: variants.length === 0,
        properties: parsed.data.properties,
        hasVariants: variants.length > 0,
        contentUnit: parsed.data.contentUnit,
        deferVisibilitySync: true,
        weight: parsed.data.weight !== undefined ? new Decimal(parsed.data.weight) : null,
        dimensionLength:
          parsed.data.dimensionLength !== undefined
            ? new Decimal(parsed.data.dimensionLength)
            : null,
        dimensionWidth:
          parsed.data.dimensionWidth !== undefined ? new Decimal(parsed.data.dimensionWidth) : null,
        dimensionHeight:
          parsed.data.dimensionHeight !== undefined
            ? new Decimal(parsed.data.dimensionHeight)
            : null,
      })

      if (variants.length > 0) {
        for (const variant of variants) {
          const variantBarcode =
            variant.barcode ||
            (await generateUniqueProductBarcode(tx as unknown as PrismaClient, {
              used: usedBarcodes,
            }))
          const createdVariant = await tx.productVariant.create({
            data: {
              productId: created.id,
              name: variant.name || variantBarcode,
              options: variant.options,
              properties: variant.properties,
              barcode: variantBarcode,
              price: variant.price,
              stockQuantity: variant.stockQuantity,
            },
          })
          await syncVariantBarcodeReservation(tx, createdVariant.id, variantBarcode)
        }
      }

      const attributeValues = [
        // Renk 1 → sortOrder 0, Renk 2 (varsa) → sortOrder 1, materyal → 0.
        ...(parsed.data.colorOptionId
          ? [{ productId: created.id, optionId: parsed.data.colorOptionId, sortOrder: 0 }]
          : []),
        ...(parsed.data.secondColorOptionId
          ? [{ productId: created.id, optionId: parsed.data.secondColorOptionId, sortOrder: 1 }]
          : []),
        ...(parsed.data.materialOptionId
          ? [{ productId: created.id, optionId: parsed.data.materialOptionId, sortOrder: 0 }]
          : []),
      ]
      if (attributeValues.length > 0) {
        await tx.productAttributeValue.createMany({ data: attributeValues, skipDuplicates: true })
      }

      // Price history starts with the product (e-mail plan phase 6).
      await recordPriceChanges(tx, { productIds: [created.id], source: 'product_write' })

      return created
    })

    await enqueueProductSync({ operation: 'upsert', entityId: product.id }).catch(() => {})
    return NextResponse.json({ productId: product.id }, { status: 201 })
  } catch (error) {
    if (error instanceof ConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    if (isBarcodeConflict(error)) {
      return NextResponse.json(
        { error: 'Bu barkod başka bir ürün veya varyantta kullanılmıştır.' },
        { status: 409 },
      )
    }
    throw error
  }
}
