import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { PageHeader, normalizeMediaDisplayUrl } from '@hanuja/ui'
import { ArrowLeft } from 'lucide-react'
import { getSellerFromSession } from '@/lib/seller-session'
import { createCatalogService } from '@hanuja/api/services/catalog.service'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import ProductEditForm from './_components/product-edit-form'

export const dynamic = 'force-dynamic'

interface Props { params: Promise<{ id: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params
  return { title: `Ürün Düzenle — ${id.slice(0, 8)}` }
}

export default async function EditProductPage({ params }: Props) {
  const { id } = await params
  const { seller } = await getSellerFromSession()

  const prisma = createPrismaForRoute()
  const svc = createCatalogService({ prisma })
  const [product, allCategories, attributeValues] = await Promise.all([
    svc.getProductForSeller(id, seller.id).catch(() => null),
    svc.listAllCategories(),
    prisma.productAttributeValue.findMany({
      where: { productId: id },
      include: { option: { select: { id: true, type: true } } },
      orderBy: { sortOrder: 'asc' },
    }),
  ])

  if (!product) notFound()

  type ProductImage = { id: string; url: string; altText?: string | null; isPrimary?: boolean | null }
  type ProductVariant = {
    id: string
    options: unknown
    barcode: string
    price: { toNumber(): number } | number
    stockQuantity: number
  }
  type ProductData = {
    id: string
    name: string
    description: string | null
    shortDescription: string | null
    story: string | null
    careInstructions: string | null
    categoryId: string | null
    price: { toNumber(): number } | number
    fulfillmentDays: number | null
    compareAtPrice: { toNumber(): number } | number | null
    stockQuantity: number | null
    sku: string | null
    modelCode: string | null
    barcode: string | null
    status: string
    dimensionWidth: { toNumber(): number } | number | null
    dimensionLength: { toNumber(): number } | number | null
    dimensionHeight: { toNumber(): number } | number | null
    images?: ProductImage[]
    variants?: ProductVariant[]
  }

  const p = product as unknown as ProductData
  // Renk değerleri sortOrder'a göre sıralı: [0] = Renk 1, [1] = Renk 2.
  const colorValues = attributeValues.filter((av) => av.option.type === 'color')
  const initialColorOptionId = colorValues[0]?.optionId ?? ''
  const initialSecondColorOptionId = colorValues[1]?.optionId ?? ''
  const initialMaterialOptionId = attributeValues.find((av) => av.option.type === 'material')?.optionId ?? ''
  const toNumberOrNull = (value: { toNumber(): number } | number | null) =>
    value == null ? null : typeof value === 'object' ? value.toNumber() : Number(value)
  const initialDimensionWidth = toNumberOrNull(p.dimensionWidth)
  const initialDimensionLength = toNumberOrNull(p.dimensionLength)
  const initialDimensionHeight = toNumberOrNull(p.dimensionHeight)

  const price = typeof p.price === 'object' ? p.price.toNumber() : Number(p.price)
  const compareAtPrice =
    p.compareAtPrice && typeof p.compareAtPrice === 'object'
      ? p.compareAtPrice.toNumber()
      : (p.compareAtPrice ?? null)
  const categories = allCategories.map((category) => ({
    id: category.id,
    name: category.name,
    parentId: category.parentId,
  }))
  const existingImages = (p.images ?? []).map((img) => ({
    id: img.id,
    url: normalizeMediaDisplayUrl(img.url),
    key: img.id, // key used by FileUpload UploadedAsset type
    isPrimary: Boolean(img.isPrimary),
  }))
  const initialVariants = (p.variants ?? []).map((variant) => {
    const options =
      variant.options && typeof variant.options === 'object' && !Array.isArray(variant.options)
        ? (variant.options as Record<string, unknown>)
        : {}
    const customEntry = Object.entries(options).find(([key]) => key !== 'Renk' && key !== 'Materyal' && key !== 'Beden')
    return {
      localId: variant.id,
      dbId: variant.id,
      color: typeof options['Renk'] === 'string' ? options['Renk'] : '',
      material: typeof options['Materyal'] === 'string' ? options['Materyal'] : '',
      size: typeof options['Beden'] === 'string' ? options['Beden'] : '',
      customOptionName: customEntry?.[0] ?? '',
      customOptionValue: typeof customEntry?.[1] === 'string' ? customEntry[1] : '',
      barcode: variant.barcode,
      price: String(variant.price != null && typeof variant.price === 'object' ? variant.price.toNumber() : Number(variant.price ?? 0)),
      stockQuantity: String(variant.stockQuantity),
    }
  })

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <Link href="/urunler" className="mb-4 inline-flex items-center gap-1.5 text-sm" style={{ color: 'var(--color-muted-fg)' }}>
          <ArrowLeft className="h-4 w-4" /> Ürünlere Dön
        </Link>
        <PageHeader title="Ürün Düzenle" description={p.name} />
      </div>

      <ProductEditForm
        productId={p.id}
        initialName={p.name}
        initialDescription={p.description ?? ''}
        initialShortDescription={p.shortDescription ?? ''}
        initialStory={p.story ?? ''}
        initialCareInstructions={p.careInstructions ?? ''}
        initialCategoryId={p.categoryId ?? ''}
        initialPrice={price}
        initialFulfillmentDays={p.fulfillmentDays ?? 20}
        initialCompareAtPrice={compareAtPrice}
        initialStock={p.stockQuantity ?? 0}
        initialSku={p.sku ?? ''}
        initialModelCode={p.modelCode ?? ''}
        initialBarcode={p.barcode ?? ''}
        initialStatus={p.status}
        initialVariants={initialVariants}
        existingImages={existingImages}
        categories={categories}
        initialColorOptionId={initialColorOptionId}
        initialSecondColorOptionId={initialSecondColorOptionId}
        initialMaterialOptionId={initialMaterialOptionId}
        initialDimensionWidth={initialDimensionWidth}
        initialDimensionLength={initialDimensionLength}
        initialDimensionHeight={initialDimensionHeight}
      />
    </div>
  )
}
