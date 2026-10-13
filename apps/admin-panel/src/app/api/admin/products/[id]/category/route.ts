import { headers } from 'next/headers'
import { NextRequest } from 'next/server'
import { Prisma, type PrismaClient } from '@prisma/client'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { checkCsrf } from '@hanuja/api/lib/csrf-check'
import { handleError, ok } from '@hanuja/api/lib/response'
import { ForbiddenError, UnauthorizedError, ValidationError } from '@hanuja/api/lib/errors'
import {
  resolveCategorySchema,
  categoryChangePreview,
  normalizedVariantProperties,
  lockCatalogSchema,
} from '@hanuja/api/services/category-schema.service'
import { createCatalogService } from '@hanuja/api/services/catalog.service'
import { lockProductStocks } from '@hanuja/api/domain/product-stock'
import {
  categoryVariantPresentation,
  variantPropertyKey,
  type ProductProperties,
} from '@hanuja/api/domain/category-schema'
import { enqueueProductSync } from '@hanuja/api/jobs/search-index-sync.job'
const properties = z.record(z.union([z.string(), z.number().finite(), z.boolean(), z.null()]))
const inputSchema = z.object({
  categoryId: z.string().min(1),
  preview: z.boolean().optional(),
  properties: properties.optional(),
  contentUnit: z.enum(['ml', 'g', 'adet']).optional(),
  confirmationToken: z.string().optional(),
  variants: z.array(z.object({ id: z.string(), properties })).optional(),
})
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const csrf = checkCsrf(req)
    if (csrf) return csrf
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) throw new UnauthorizedError()
    if (session.user.role !== 'admin') throw new ForbiddenError()
    const { id } = await params,
      input = inputSchema.parse(await req.json()),
      db = createPrismaForRoute()
    const result = await db.$transaction(async (tx) => {
      await lockCatalogSchema(tx)
      await lockProductStocks(tx, [id])
      const product = await tx.product.findUnique({
        where: { id },
        include: { variants: true, attributeValues: { include: { option: true } } },
      })
      if (!product) throw new ValidationError('Ürün bulunamadı.')
      const schema = await resolveCategorySchema(tx, input.categoryId),
        preview = categoryChangePreview(product, schema, input.contentUnit)
      if (input.preview) return { ...preview, schema }
      if (preview.removed.length && preview.confirmationToken !== input.confirmationToken)
        throw new ValidationError('Silinecek özellikleri önizleyip onaylayın.')
      const incoming = input.variants ?? []
      if (
        incoming.length !== product.variants.length ||
        new Set(incoming.map((v) => v.id)).size !== incoming.length ||
        incoming.some((v) => !product.variants.some((p) => p.id === v.id))
      )
        throw new ValidationError('Mevcut varyantların tamamı için hedef özellikleri girin.')
      const allowed = new Set(schema.config.fields.map((f) => f.key))
      const values = {
        ...Object.fromEntries(
          Object.entries(product.properties as ProductProperties).filter(([key]) =>
            allowed.has(key),
          ),
        ),
        ...input.properties,
      }
      const key = variantPropertyKey(schema, input.contentUnit)
      const variants = incoming.map((v) => ({
        id: v.id,
        properties: normalizedVariantProperties(
          schema,
          v.properties,
          values,
          input.contentUnit,
          {},
          true,
        ),
      }))
      const saved = await createCatalogService({
        prisma: tx as unknown as PrismaClient,
      }).updateProductForSeller({
        productId: id,
        sellerId: product.sellerId,
        categoryId: input.categoryId,
        properties: Object.fromEntries(
          Object.entries(values).filter(
            ([k]) => !variants.length || (k !== key && !schema.config.contentKeys.includes(k)),
          ),
        ),
        contentUnit: input.contentUnit,
        hasVariants: variants.length > 0,
        variantsManaged: true,
        adminActorId: session.user.id,
        categoryChangeValidated: true,
        deferVisibilitySync: true,
      })
      for (const variant of variants)
        await tx.productVariant.update({
          where: { id: variant.id },
          data: {
            properties: variant.properties as Prisma.InputJsonValue,
            ...categoryVariantPresentation(schema, variant.properties, input.contentUnit),
            name:
              categoryVariantPresentation(schema, variant.properties, input.contentUnit).name ||
              product.variants.find((v) => v.id === variant.id)!.barcode,
          },
        })
      return { productId: saved.id }
    })
    if (!input.preview)
      await enqueueProductSync({ operation: 'upsert', entityId: id }).catch(() => {})
    return ok(result)
  } catch (error) {
    return handleError(error)
  }
}
