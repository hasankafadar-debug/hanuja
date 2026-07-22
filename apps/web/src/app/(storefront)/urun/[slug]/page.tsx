import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import {
  Breadcrumb,
  Separator,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  normalizeMediaDisplayUrl,
} from '@hanuja/ui'
import { BadgePercent, RotateCcw, Shield, Truck } from 'lucide-react'
import { formatMoney } from '@hanuja/security'
import {
  buildProductMetadata,
  buildProductStructuredData,
  buildBreadcrumbStructuredData,
  JsonLd,
} from '@hanuja/seo'
import { createCatalogService } from '@hanuja/api/services/catalog.service'
import { createProductReviewService } from '@hanuja/api/services/product-review.service'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { NotFoundError } from '@hanuja/api/lib/errors'
import AddToCartButton from './add-to-cart-button'
import { ReviewStars } from './_components/review-stars'
import { ReviewList } from './_components/review-list'
import ReviewForm from './_components/review-form'
import ProductGallery from './_components/product-gallery'
import { StoreFollowButton } from './_components/store-follow-button'
import { ProductViewTracker } from './_components/product-view-tracker'

export const revalidate = 300

interface Props {
  params: Promise<{ slug: string }>
}

async function getProduct(slug: string) {
  try {
    const svc = createCatalogService({ prisma: createPrismaForRoute() })
    return await svc.getProductBySlug(slug)
  } catch (err) {
    if (err instanceof NotFoundError) return null
    throw err
  }
}

async function getVisualSiblings(params: { sellerId: string; categoryId: string; modelCode: string }) {
  const prisma = createPrismaForRoute()
  return prisma.product.findMany({
    where: {
      sellerId: params.sellerId,
      categoryId: params.categoryId,
      modelCode: params.modelCode,
      status: 'published',
      seller: { is: { status: 'active' } },
    },
    select: {
      id: true,
      slug: true,
      name: true,
      attributeValues: {
        select: {
          option: {
            select: { type: true, label: true, hexColor: true },
          },
        },
      },
    },
    orderBy: [{ createdAt: 'asc' }, { name: 'asc' }],
  })
}

function getAttributeLabel(
  attributeValues: Array<{ option?: { type?: string; label?: string; hexColor?: string | null } }> | undefined,
  type: 'color' | 'material',
) {
  return attributeValues?.find((attribute) => attribute.option?.type === type)?.option ?? null
}

function buildVisualOptionLabel(
  attributeValues: Array<{ option?: { type?: string; label?: string; hexColor?: string | null } }> | undefined,
  fallback: string,
) {
  const color = getAttributeLabel(attributeValues, 'color')?.label
  const material = getAttributeLabel(attributeValues, 'material')?.label
  return [color, material].filter(Boolean).join(' / ') || fallback
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const product = await getProduct(slug)
  if (!product) {
    return { title: 'Ürün Bulunamadı' }
  }
  return buildProductMetadata({
    name: product.name,
    description: product.shortDescription ?? product.description ?? `${product.name} — Hanuja'da satışta.`,
    slug,
    price: Number(product.price),
  })
}

export default async function ProductDetailPage({ params }: Props) {
  const { slug } = await params
  const product = await getProduct(slug)

  if (!product) notFound()

  const fulfillmentText =
    typeof product.fulfillmentDays === 'number'
      ? `Sevk Süresi: ${product.fulfillmentDays} iş günü`
      : null

  const seller = product.seller as { displayName: string; slug: string } | null
  const category = product.category as { id: string; name: string; slug: string } | null
  const images = (product.images ?? []) as Array<{ url: string; altText?: string | null }>
  const variants = ((product.variants ?? []) as Array<{
    id: string
    name: string
    price: { toNumber(): number } | number | null
    stockQuantity: number
    options: unknown
  }>).map((variant) => ({
    id: variant.id,
    name: variant.name,
    price:
      variant.price === null
        ? null
        : typeof variant.price === 'object'
          ? variant.price.toNumber()
          : Number(variant.price),
    stockQuantity: variant.stockQuantity,
    options:
      variant.options && typeof variant.options === 'object'
        ? (variant.options as Record<string, string>)
        : {},
  }))

  const reviewService = createProductReviewService({ prisma: createPrismaForRoute() })
  const { items: reviews, total: reviewTotal } = await reviewService.listForProduct({
    productId: product.id,
    take: 20,
  })
  const avgRating = product.avgRating ? Number(product.avgRating) : 0
  const reviewCount = product.reviewCount ?? 0

  const price = Number(product.price)
  const compareAtPrice = product.compareAtPrice ? Number(product.compareAtPrice) : null
  const colorValue =
    (product.attributeValues as Array<{ option?: { type?: string; label?: string } }> | undefined)?.find(
      (attribute) => attribute.option?.type === 'color',
    )?.option?.label ?? null
  const materialValue =
    (product.attributeValues as Array<{ option?: { type?: string; label?: string } }> | undefined)?.find(
      (attribute) => attribute.option?.type === 'material',
    )?.option?.label ?? null
  const visualSiblings = product.modelCode?.trim() && category?.id
    ? await getVisualSiblings({ sellerId: product.sellerId, categoryId: category.id, modelCode: product.modelCode.trim() })
    : []
  const story = product.story?.trim()
  const careInstructions = product.careInstructions?.trim()
  const hasSpecs = Boolean(category) || typeof product.stockQuantity === 'number'

  const breadcrumbItems = [
    { label: 'Anasayfa', href: '/' },
    ...(category ? [{ label: category.name, href: `/kategori/${category.slug}` }] : []),
    { label: product.name },
  ]

  const productJsonLd = buildProductStructuredData({
    name: product.name,
    description: product.description ?? '',
    slug,
    price,
    availability: (product.stockQuantity ?? 0) > 0 ? 'InStock' : 'OutOfStock',
    sku: product.id,
    ...(reviewCount > 0
      ? { aggregateRating: { ratingValue: avgRating, reviewCount } }
      : {}),
  })

  const breadcrumbJsonLd = buildBreadcrumbStructuredData([
    { name: 'Ana Sayfa', url: '/' },
    ...(category ? [{ name: category.name, url: `/kategori/${category.slug}` }] : []),
    { name: product.name, url: `/urun/${slug}` },
  ])

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <JsonLd data={productJsonLd} />
      <JsonLd data={breadcrumbJsonLd} />
      <ProductViewTracker slug={slug} />
      <Breadcrumb items={breadcrumbItems} className="mb-6" />

      <div className="grid grid-cols-1 gap-10 lg:grid-cols-2">
        {/* Image gallery */}
        <ProductGallery
          images={images.map((image) => ({
            url: normalizeMediaDisplayUrl(image.url),
            altText: image.altText ?? null,
          }))}
          productName={product.name}
        />

        {/* Product info */}
        <div className="flex flex-col gap-6">
          <div>
            {seller?.slug && (
              <div className="flex flex-wrap items-center gap-3 text-sm" style={{ color: 'var(--color-muted-fg)' }}>
                <p>
                  <Link
                    href={`/magaza/${seller.slug}`}
                    className="hover:underline"
                    style={{ color: 'var(--color-accent)' }}
                  >
                    {seller.displayName}
                  </Link>
                </p>
                <StoreFollowButton sellerId={product.sellerId} />
              </div>
            )}
            <h1
              className="mt-1 text-2xl font-semibold leading-snug"
              style={{ fontFamily: 'var(--font-display)', color: 'var(--color-primary)' }}
            >
              {product.name}
            </h1>
            {reviewCount > 0 && (
              <div className="mt-2 flex items-center gap-2 text-sm" style={{ color: 'var(--color-muted-fg)' }}>
                <ReviewStars value={avgRating} size={16} />
                <span>
                  {avgRating.toFixed(1)} <span className="text-xs">({reviewCount} değerlendirme)</span>
                </span>
              </div>
            )}
            {product.shortDescription && (
              <p className="mt-3 max-w-2xl text-sm leading-relaxed" style={{ color: 'var(--color-muted-fg)' }}>
                {product.shortDescription}
              </p>
            )}
          </div>

          {/* Statik ürün fiyatı — varyasyonsuz ürünler için başlangıç değeri gösterilir.
              Varyasyonlu ürünlerde fiyat ve stok, AddToCartButton içinde seçime göre güncellenir. */}
          {variants.length === 0 && (
            <>
              <div className="flex items-baseline gap-3">
                <span className="text-3xl font-bold" style={{ color: 'var(--color-primary)' }}>
                  {formatMoney(price)}
                </span>
                {compareAtPrice && compareAtPrice > price && (
                  <span className="text-sm line-through" style={{ color: 'var(--color-muted-fg)' }}>
                    {formatMoney(compareAtPrice)}
                  </span>
                )}
              </div>
              {(colorValue || materialValue) && (
                <div className="mt-2 flex flex-wrap gap-3 text-sm" style={{ color: 'var(--color-muted-fg)' }}>
                  {colorValue ? <span><strong>Renk:</strong> {colorValue}</span> : null}
                  {materialValue ? <span><strong>Materyal:</strong> {materialValue}</span> : null}
                </div>
              )}

              <Separator />

              <div className="flex items-center gap-4 text-sm" style={{ color: 'var(--color-muted-fg)' }}>
                <span className="flex items-center gap-1">
                  <span
                    className="inline-block h-2 w-2 rounded-full"
                    style={{
                      backgroundColor:
                        (product.stockQuantity ?? 0) > 0 ? 'var(--color-success)' : 'var(--color-destructive)',
                    }}
                  />
                  {(product.stockQuantity ?? 0) > 0 ? `Stokta (${product.stockQuantity} adet)` : 'Stokta yok'}
                </span>
                {fulfillmentText ? <span>{fulfillmentText}</span> : null}
              </div>
            </>
          )}

          {/* Add to cart — varyasyonlu ürünlerde fiyat ve stok burada güncellenir */}
          <AddToCartButton
            productId={product.id}
            productName={product.name}
            basePrice={price}
            compareAtPrice={compareAtPrice}
            fulfillmentDays={typeof product.fulfillmentDays === 'number' ? product.fulfillmentDays : null}
            stock={product.stockQuantity}
            variants={variants}
          />

          {visualSiblings.length > 1 ? (
            <div className="space-y-2">
              <p className="text-sm font-medium" style={{ color: 'var(--color-primary)' }}>
                Renk / Materyal
              </p>
              <div className="flex flex-wrap gap-2">
                {visualSiblings.map((sibling) => {
                  const isCurrent = sibling.id === product.id
                  const color = getAttributeLabel(sibling.attributeValues, 'color')
                  const label = buildVisualOptionLabel(sibling.attributeValues, sibling.name)

                  return (
                    <Link
                      key={sibling.id}
                      href={`/urun/${sibling.slug}`}
                      aria-current={isCurrent ? 'page' : undefined}
                      className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors"
                      style={{
                        borderColor: isCurrent ? 'var(--color-primary)' : 'var(--color-border)',
                        backgroundColor: isCurrent ? 'var(--color-muted)' : 'var(--color-surface)',
                        color: 'var(--color-primary)',
                      }}
                    >
                      {color?.hexColor ? (
                        <span
                          className="inline-block h-3 w-3 rounded-full border"
                          style={{ backgroundColor: color.hexColor, borderColor: 'var(--color-border)' }}
                        />
                      ) : null}
                      {label}
                    </Link>
                  )
                })}
              </div>
            </div>
          ) : null}

          {/* Trust badges */}
          <div
            className="grid grid-cols-2 gap-3 rounded-xl p-4 text-center text-xs md:grid-cols-4"
            style={{ backgroundColor: 'var(--color-muted)' }}
          >
            <div className="flex flex-col items-center gap-1" style={{ color: 'var(--color-muted-fg)' }}>
              <RotateCcw className="h-5 w-5" />
              <span>14 Gün İade</span>
            </div>
            <div className="flex flex-col items-center gap-1" style={{ color: 'var(--color-muted-fg)' }}>
              <Shield className="h-5 w-5" />
              <span>Güvenli Ödeme</span>
            </div>
            <div className="flex flex-col items-center gap-1" style={{ color: 'var(--color-muted-fg)' }}>
              <BadgePercent className="h-5 w-5" />
              <span>En İyi Fiyat Garantisi</span>
            </div>
            <div className="flex flex-col items-center gap-1" style={{ color: 'var(--color-muted-fg)' }}>
              <Truck className="h-5 w-5" />
              <span>Ücretsiz Kargo</span>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="mt-16">
        <Tabs defaultValue="description">
          <div className="max-w-full overflow-x-auto">
            <TabsList className="min-w-max">
              <TabsTrigger value="description">Açıklama</TabsTrigger>
              <TabsTrigger value="story">Ürün Hikayesi</TabsTrigger>
              <TabsTrigger value="care">Bakım Tavsiyesi</TabsTrigger>
              {hasSpecs && <TabsTrigger value="specs">Özellikler</TabsTrigger>}
              <TabsTrigger value="reviews">Değerlendirmeler</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="description" className="mt-6 max-w-2xl">
            <p className="leading-relaxed" style={{ color: 'var(--color-muted-fg)' }}>
              {product.description ?? 'Açıklama henüz eklenmemiş.'}
            </p>
          </TabsContent>

          <TabsContent value="story" className="mt-6 max-w-2xl">
            <p className="leading-relaxed" style={{ color: 'var(--color-muted-fg)' }}>
              {story || 'Ürün hikayesi henüz eklenmemiş.'}
            </p>
          </TabsContent>

          <TabsContent value="care" className="mt-6 max-w-2xl">
            <p className="leading-relaxed" style={{ color: 'var(--color-muted-fg)' }}>
              {careInstructions || 'Bakım tavsiyesi henüz eklenmemiş.'}
            </p>
          </TabsContent>

          {hasSpecs && (
            <TabsContent value="specs" className="mt-6 max-w-md">
              <dl className="divide-y" style={{ borderColor: 'var(--color-border)' }}>
                {category && (
                  <div className="flex justify-between py-3 text-sm">
                    <dt style={{ color: 'var(--color-muted-fg)' }}>Kategori</dt>
                    <dd className="font-medium" style={{ color: 'var(--color-primary)' }}>{category.name}</dd>
                  </div>
                )}
                <div className="flex justify-between py-3 text-sm">
                  <dt style={{ color: 'var(--color-muted-fg)' }}>Stok</dt>
                  <dd className="font-medium" style={{ color: 'var(--color-primary)' }}>{product.stockQuantity ?? 0} adet</dd>
                </div>
              </dl>
            </TabsContent>
          )}

          <TabsContent value="reviews" className="mt-6 max-w-3xl">
            <div className="space-y-10">
              <ReviewList reviews={reviews} total={reviewTotal} />
              <div>
                <h3 className="text-base font-semibold mb-3" style={{ color: 'var(--color-primary)' }}>
                  Değerlendirme yaz
                </h3>
                <ReviewForm productSlug={slug} />
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
