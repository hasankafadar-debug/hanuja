import { validateVariantDescriptor } from '@hanuja/api/services/category-schema.service'
import { headers } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import type { PrismaClient } from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/client'
import { z } from 'zod'
import { createCatalogService } from '@hanuja/api/services/catalog.service'
import { recordPriceChanges } from '@hanuja/api/services/price-history.service'
import { ConflictError, ValidationError } from '@hanuja/api/lib/errors'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import {
  isBarcodeConflict,
  prepareVariantBarcodeReplacement,
  syncVariantBarcodeReservation,
} from '@hanuja/api/domain/barcode-registry'
import { generateUniqueProductBarcode } from '@hanuja/api/domain/barcode-generate'
import { requireModelCode } from '@hanuja/api/domain/model-code'
import { lockProductStocks } from '@hanuja/api/domain/product-stock'
import {
  resolveCategorySchema,
  lockCatalogSchema,
  categoryChangePreview,
  validateSharedAttributes,
  normalizedVariantProperties,
} from '@hanuja/api/services/category-schema.service'
import { propertyLabel, variantPropertyKey } from '@hanuja/api/domain/category-schema'
import { enqueueProductSync } from '@hanuja/api/jobs/search-index-sync.job'

const variantSchema = z.object({
  id: z.string().cuid().optional(), // Mevcut varyantlarda DB ID — upsert için kullanılır
  color: z
    .never({ invalid_type_error: 'Varyant rengi desteklenmiyor; ayrı ürün ekleyin.' })
    .optional(),
  material: z
    .never({ invalid_type_error: 'Varyant materyali desteklenmiyor; ayrı ürün ekleyin.' })
    .optional(),
  properties: z
    .record(z.union([z.string(), z.number(), z.boolean(), z.null()]))
    .optional()
    .default({}),
  size: z.string().trim().max(80).optional(),
  customOptionName: z.string().trim().max(80).optional(),
  customOptionValue: z.string().trim().max(120).optional(),
  // Optional: blank barcodes are auto-generated ("8"-prefixed EAN-13) on save.
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

const updateProductSchema = z
  .object({
    name: z.string().min(3).max(200).optional(),
    brand: z.string().trim().min(1, 'Marka zorunludur.').max(120).optional(),
    categoryId: z.string().min(1).nullable().optional(),
    description: z.string().max(5000).optional(),
    shortDescription: z.string().max(500).optional(),
    story: z.string().max(5000).optional(),
    careInstructions: z.string().max(5000).optional(),
    price: z.number().nonnegative().optional(),
    compareAtPrice: z.number().positive('Liste fiyati 0dan buyuk olmali').nullable().optional(),
    fulfillmentDays: z
      .number()
      .int()
      .min(1, 'Sevk suresi en az 1 is gunu olmali')
      .max(90, 'Sevk suresi en fazla 90 is gunu olabilir')
      .optional(),
    stockQuantity: z.number().int().min(0).optional(),
    sku: z.string().max(120).nullable().optional(),
    modelCode: z.string().min(1, 'Model Kodu zorunludur').max(120).optional(),
    barcode: z
      .string()
      .trim()
      .refine((value) => value === '' || /^\d{13}$/.test(value), 'Barkod 13 haneli rakam olmali')
      .nullable()
      .optional(),
    weight: z.number().positive().nullable().optional(),
    // Boyutlar (cm) — opsiyonel; null = temizle. En → dimensionWidth, Boy → dimensionLength, Yukseklik → dimensionHeight.
    dimensionLength: z.number().positive().nullable().optional(),
    dimensionWidth: z.number().positive().nullable().optional(),
    dimensionHeight: z.number().positive().nullable().optional(),
    colorOptionId: z.string().min(1).nullable().optional(),
    // Renk 2 (opsiyonel): null/boş = ikinci rengi kaldır. Renk 1'den farklı olmalı.
    secondColorOptionId: z.string().min(1).nullable().optional(),
    materialOptionId: z.string().min(1).nullable().optional(),
    variants: z.array(variantSchema).max(100).optional(),
    properties: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
    contentUnit: z.enum(['ml', 'g', 'adet']).optional(),
    categoryChangeConfirmation: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.variants && data.variants.length > 0 && data.barcode?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['barcode'],
        message: 'Varyasyonlu urunde ana barkod bos birakilmali.',
      })
    }
    if (data.secondColorOptionId && !data.colorOptionId)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['secondColorOptionId'],
        message: 'Ikinci renk icin birinci renk secilmelidir.',
      })
    if (data.secondColorOptionId && data.secondColorOptionId === data.colorOptionId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['secondColorOptionId'],
        message: 'Ikinci renk birinci renkten farkli olmalidir.',
      })
    }
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
    id: input.id,
    // Barcode may be blank (auto-generated on save); name falls back to the
    // resolved barcode at write time.
    name: Object.entries(options)
      .map(([key, value]) => `${key}: ${value}`)
      .join(' / '),
    options,
    barcode: input.barcode?.trim() ?? '',
    price: new Decimal(input.price),
    stockQuantity: input.stockQuantity,
  }
}
async function getSellerOrFail(prisma: PrismaClient) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return null
  return prisma.seller.findUnique({ where: { userId: session.user.id } })
}

async function assertVariantBarcodesAvailable(params: {
  prisma: PrismaClient
  productId: string
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
    params.prisma.product.findFirst({
      where: { barcode: { in: uniqueBarcodes }, id: { not: params.productId } },
      select: { barcode: true },
    }),
    params.prisma.productVariant.findFirst({
      where: { barcode: { in: uniqueBarcodes }, productId: { not: params.productId } },
      select: { barcode: true },
    }),
  ])

  if (productBarcode || variantBarcode) {
    throw new ConflictError('Varyasyon barkodlarindan biri zaten kullaniliyor.')
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const prisma = createPrismaForRoute()
  const seller = await getSellerOrFail(prisma)
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
        prisma,
        productId: id,
        barcodes: variants.map((variant) => variant.barcode),
        productBarcode: parsed.data.barcode?.trim() || null,
      })
    }

    // Seeded with entered barcodes so auto-generated ones cannot collide with a
    // still-pending entered barcode in the same request.
    const usedBarcodes = new Set<string>([
      ...(variants?.map((variant) => variant.barcode).filter(Boolean) ?? []),
      ...(parsed.data.barcode?.trim() ? [parsed.data.barcode.trim()] : []),
    ])

    const updated = await prisma.$transaction(async (tx) => {
      await lockCatalogSchema(tx)
      await lockProductStocks(tx, [id])
      const existing = await tx.product.findFirst({
        where: { id, sellerId: seller.id },
        include: { variants: true, attributeValues: { include: { option: true } } },
      })
      if (!existing) throw new ValidationError('Ürün bulunamadı.')
      const schema = await resolveCategorySchema(
        tx,
        parsed.data.categoryId ?? existing.categoryId ?? '',
      )
      await validateSharedAttributes(
        tx,
        schema,
        parsed.data,
        parsed.data.categoryId !== undefined && parsed.data.categoryId !== existing.categoryId
          ? []
          : existing.attributeValues.map((a) => a.optionId),
      )
      if (parsed.data.categoryId !== undefined && parsed.data.categoryId !== existing.categoryId) {
        const preview = categoryChangePreview(existing, schema, parsed.data.contentUnit)
        if (
          preview.removed.length &&
          preview.confirmationToken !== parsed.data.categoryChangeConfirmation
        )
          throw new ValidationError(
            'Kategori değişirken silinecek özellikleri önizleyip onaylayın.',
          )
      }
      if (variants)
        for (const [index, variant] of variants.entries()) {
          const input = parsed.data.variants![index]!
          const old = existing.variants.find((v) => v.id === input.id)
          const key = variantPropertyKey(schema, parsed.data.contentUnit)
          const raw = { ...input.properties }
          if (key && raw[key] === undefined && input.size) raw[key] = input.size
          const changed =
            parsed.data.categoryId !== undefined && parsed.data.categoryId !== existing.categoryId
          const previous = (old?.properties ??
            {}) as import('@hanuja/api/domain/category-schema').ProductProperties
          const properties = normalizedVariantProperties(
            schema,
            raw,
            {
              ...(existing.properties as import('@hanuja/api/domain/category-schema').ProductProperties),
              ...parsed.data.properties,
            },
            parsed.data.contentUnit,
            changed
              ? Object.fromEntries(Object.entries(previous).filter(([k]) => k === key))
              : previous,
            !old || changed,
          )
          validateVariantDescriptor(input.customOptionName, schema.config.variantLabel ?? undefined)
          if (old && !changed) {
            const legacy = old.options as Record<string, string>
            for (const label of ['Renk', 'Materyal'])
              if (legacy[label]) variant.options[label] = legacy[label]!
          }
          const definition = schema.definitions.find((f) => f.key === key)
          if (definition && key) {
            delete variant.options.Beden
            variant.options[schema.config.variantLabel ?? definition.label] = propertyLabel(
              definition,
              properties[key] ?? null,
            )
          }
          Object.assign(variant, {
            properties,
            name: Object.entries(variant.options)
              .map(([k, v]) => `${k}: ${v}`)
              .join(' / '),
          })
        }
      if (variants !== undefined) {
        const incomingIds = variants
          .filter((variant) => variant.id)
          .map((variant) => variant.id as string)
        if (incomingIds.length > 0) {
          const ownedVariantCount = await tx.productVariant.count({
            where: { productId: id, id: { in: incomingIds } },
          })
          if (ownedVariantCount !== incomingIds.length) {
            throw new ValidationError('Varyasyonlardan biri bu urune ait degil.')
          }
        }

        // Only entered barcodes matter here; temporary barcodes are "9"-prefixed
        // and generated ones are "8"-prefixed, so blanks never collide.
        const finalBarcodes = [
          ...variants.map((variant) => variant.barcode).filter(Boolean),
          ...(variants.length === 0 && parsed.data.barcode?.trim()
            ? [parsed.data.barcode.trim()]
            : []),
        ]
        await prepareVariantBarcodeReplacement(tx, id, finalBarcodes)
        const deletedIds = existing.variants
          .filter((v) => !incomingIds.includes(v.id))
          .map((v) => v.id)
        if (
          deletedIds.length &&
          (await tx.orderLine.count({ where: { productId: id, variantId: { in: deletedIds } } })) >
            0
        )
          throw new ValidationError('Siparişe bağlı varyant silinemez.')
        await tx.productVariant.deleteMany({
          where: {
            productId: id,
            ...(variants.length > 0 ? { id: { notIn: incomingIds } } : {}),
          },
        })
      }

      // Resolve the main product barcode. A variantless product must keep a
      // barcode: if the field is provided but blank, auto-generate one; a
      // variant product always has a null main barcode.
      let resolvedMainBarcode: string | null | undefined
      if (variants !== undefined) {
        if (variants.length > 0) {
          resolvedMainBarcode = null
        } else {
          resolvedMainBarcode =
            parsed.data.barcode?.trim() ||
            (await generateUniqueProductBarcode(tx as unknown as PrismaClient, {
              used: usedBarcodes,
            }))
        }
      } else if (parsed.data.barcode !== undefined) {
        const entered = parsed.data.barcode?.trim()
        if (entered) {
          resolvedMainBarcode = entered
        } else {
          const variantCount = await tx.productVariant.count({ where: { productId: id } })
          resolvedMainBarcode =
            variantCount === 0
              ? await generateUniqueProductBarcode(tx as unknown as PrismaClient, {
                  used: usedBarcodes,
                })
              : null
        }
      }

      const service = createCatalogService({ prisma: tx as unknown as PrismaClient })
      const saved = await service.updateProductForSeller({
        productId: id,
        sellerId: seller.id,
        ...(parsed.data.brand !== undefined ? { brand: parsed.data.brand } : {}),
        properties: parsed.data.properties,
        contentUnit: parsed.data.contentUnit,
        categoryChangeConfirmation: parsed.data.categoryChangeConfirmation,
        categoryChangeValidated: true,
        deferVisibilitySync: true,
        variantsManaged: variants !== undefined,
        hasVariants: variants !== undefined ? variants.length > 0 : existing.variants.length > 0,
        ...(typeof parsed.data.name === 'string' && parsed.data.name.trim()
          ? { name: parsed.data.name.trim() }
          : {}),
        ...(parsed.data.categoryId !== undefined
          ? { categoryId: parsed.data.categoryId?.trim() || null }
          : {}),
        ...(typeof parsed.data.description === 'string'
          ? { description: parsed.data.description.trim() || null }
          : {}),
        ...(typeof parsed.data.shortDescription === 'string'
          ? { shortDescription: parsed.data.shortDescription.trim() || null }
          : {}),
        ...(typeof parsed.data.story === 'string'
          ? { story: parsed.data.story.trim() || null }
          : {}),
        ...(typeof parsed.data.careInstructions === 'string'
          ? { careInstructions: parsed.data.careInstructions.trim() || null }
          : {}),
        ...(typeof parsed.data.price === 'number' ? { price: new Decimal(parsed.data.price) } : {}),
        ...(parsed.data.compareAtPrice !== undefined
          ? {
              compareAtPrice:
                parsed.data.compareAtPrice !== null
                  ? new Decimal(parsed.data.compareAtPrice)
                  : null,
            }
          : {}),
        ...(typeof parsed.data.fulfillmentDays === 'number'
          ? { fulfillmentDays: parsed.data.fulfillmentDays }
          : {}),
        ...(variants && variants.length > 0
          ? { stockQuantity: variants.reduce((sum, variant) => sum + variant.stockQuantity, 0) }
          : typeof parsed.data.stockQuantity === 'number'
            ? { stockQuantity: Math.floor(parsed.data.stockQuantity) }
            : {}),
        ...(parsed.data.sku !== undefined ? { sku: parsed.data.sku?.trim() || null } : {}),
        ...(parsed.data.modelCode !== undefined
          ? { modelCode: requireModelCode(parsed.data.modelCode) }
          : {}),
        ...(resolvedMainBarcode !== undefined ? { barcode: resolvedMainBarcode } : {}),
        ...(parsed.data.weight !== undefined
          ? { weight: parsed.data.weight !== null ? new Decimal(parsed.data.weight) : null }
          : {}),
        ...(parsed.data.dimensionLength !== undefined
          ? {
              dimensionLength:
                parsed.data.dimensionLength !== null
                  ? new Decimal(parsed.data.dimensionLength)
                  : null,
            }
          : {}),
        ...(parsed.data.dimensionWidth !== undefined
          ? {
              dimensionWidth:
                parsed.data.dimensionWidth !== null
                  ? new Decimal(parsed.data.dimensionWidth)
                  : null,
            }
          : {}),
        ...(parsed.data.dimensionHeight !== undefined
          ? {
              dimensionHeight:
                parsed.data.dimensionHeight !== null
                  ? new Decimal(parsed.data.dimensionHeight)
                  : null,
            }
          : {}),
      })

      if (variants !== undefined) {
        for (const variant of variants) {
          const variantBarcode =
            variant.barcode ||
            (await generateUniqueProductBarcode(tx as unknown as PrismaClient, {
              used: usedBarcodes,
            }))
          if (variant.id) {
            const updatedVariant = await tx.productVariant.update({
              where: { id: variant.id },
              data: {
                name: variant.name || variantBarcode,
                options: variant.options,
                properties: (
                  variant as typeof variant & {
                    properties: import('@hanuja/api/domain/category-schema').ProductProperties
                  }
                ).properties,
                barcode: variantBarcode,
                price: variant.price,
                stockQuantity: variant.stockQuantity,
              },
            })
            await syncVariantBarcodeReservation(tx, updatedVariant.id, variantBarcode)
          } else {
            const createdVariant = await tx.productVariant.create({
              data: {
                productId: id,
                name: variant.name || variantBarcode,
                options: variant.options,
                properties: (
                  variant as typeof variant & {
                    properties: import('@hanuja/api/domain/category-schema').ProductProperties
                  }
                ).properties,
                barcode: variantBarcode,
                price: variant.price,
                stockQuantity: variant.stockQuantity,
              },
            })
            await syncVariantBarcodeReservation(tx, createdVariant.id, variantBarcode)
          }
        }
      }

      // Update attribute values when provided. Renk 1 → sortOrder 0, Renk 2 (varsa)
      // → sortOrder 1. secondColorOptionId null/boş ise ikinci renk kaldırılır
      // (tüm renk değerleri silinip yalnız Renk 1 yazılır).
      const { colorOptionId, secondColorOptionId, materialOptionId } = parsed.data
      if (colorOptionId !== undefined) {
        await tx.productAttributeValue.deleteMany({
          where: {
            productId: id,
            option: { type: 'color' },
          },
        })
        if (colorOptionId)
          await tx.productAttributeValue.createMany({
            data: [
              { productId: id, optionId: colorOptionId, sortOrder: 0 },
              ...(secondColorOptionId
                ? [{ productId: id, optionId: secondColorOptionId, sortOrder: 1 }]
                : []),
            ],
            skipDuplicates: true,
          })
      }
      if (materialOptionId !== undefined) {
        await tx.productAttributeValue.deleteMany({
          where: {
            productId: id,
            option: { type: 'material' },
          },
        })
        if (materialOptionId)
          await tx.productAttributeValue.create({
            data: { productId: id, optionId: materialOptionId, sortOrder: 0 },
          })
      }

      // Price, category and variant changes reach the price history in this transaction
      // (e-mail plan phase 6); an unchanged price writes nothing.
      await recordPriceChanges(tx, { productIds: [id], source: 'product_write' })

      return saved
    })

    await enqueueProductSync({ operation: 'upsert', entityId: id }).catch(() => {})
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
    if (isBarcodeConflict(error)) {
      return NextResponse.json(
        { error: 'Bu barkod başka bir ürün veya varyantta kullanılmıştır.' },
        { status: 409 },
      )
    }
    throw error
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const prisma = createPrismaForRoute()
  const seller = await getSellerOrFail(prisma)
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
