import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Breadcrumb, Separator, Tabs, TabsList, TabsTrigger, TabsContent } from '@hanuja/ui'
import { Package, RotateCcw, Shield } from 'lucide-react'
import {
  buildProductMetadata,
  buildProductStructuredData,
  buildBreadcrumbStructuredData,
  JsonLd,
} from '@hanuja/seo'
import { createCatalogService } from '@hanuja/api/services/catalog.service'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { NotFoundError } from '@hanuja/api/lib/errors'
import AddToCartButton from './add-to-cart-button'

export const dynamic = 'force-dynamic'

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

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const product = await getProduct(slug)
  if (!product) {
    return { title: 'Ürün Bulunamadı' }
  }
  return buildProductMetadata({
    name: product.name,
    description: product.description ?? `${product.name} — Hanuja'da satışta.`,
    slug,
    price: Number(product.price),
  })
}

export default async function ProductDetailPage({ params }: Props) {
  const { slug } = await params
  const product = await getProduct(slug)

  if (!product) notFound()

  const seller = product.seller as { displayName: string; slug: string } | null
  const category = product.category as { name: string; slug: string } | null
  const images = (product.images ?? []) as Array<{ url: string; altText?: string | null }>

  const price = Number(product.price)

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
      <Breadcrumb items={breadcrumbItems} className="mb-6" />

      <div className="grid grid-cols-1 gap-10 lg:grid-cols-2">
        {/* Image gallery */}
        <div className="flex flex-col gap-3">
          {images.length > 0 ? (
            <>
              <div className="aspect-square w-full rounded-xl overflow-hidden">
                <img
                  src={images[0]!.url}
                  alt={images[0]!.altText ?? product.name}
                  className="h-full w-full object-cover"
                />
              </div>
              {images.length > 1 && (
                <div className="grid grid-cols-4 gap-2">
                  {images.slice(1, 5).map((img, i) => (
                    <div key={i} className="aspect-square rounded-lg overflow-hidden">
                      <img
                        src={img.url}
                        alt={img.altText ?? product.name}
                        className="h-full w-full object-cover"
                      />
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div
              className="aspect-square w-full rounded-xl flex items-center justify-center text-sm"
              style={{
                backgroundColor: 'var(--color-muted)',
                color: 'var(--color-muted-fg)',
                border: '1px solid var(--color-border)',
              }}
            >
              Ürün Görseli — {product.name}
            </div>
          )}
        </div>

        {/* Product info */}
        <div className="flex flex-col gap-6">
          <div>
            {seller?.slug && (
              <p className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>
                <Link
                  href={`/magaza/${seller.slug}`}
                  className="hover:underline"
                  style={{ color: 'var(--color-accent)' }}
                >
                  {seller.displayName}
                </Link>
              </p>
            )}
            <h1
              className="mt-1 text-2xl font-semibold leading-snug"
              style={{ fontFamily: 'var(--font-display)', color: 'var(--color-primary)' }}
            >
              {product.name}
            </h1>
          </div>

          {/* Price */}
          <div className="flex items-baseline gap-3">
            <span className="text-3xl font-bold" style={{ color: 'var(--color-primary)' }}>
              ₺{price.toLocaleString('tr-TR')}
            </span>
          </div>

          <Separator />

          {/* Stock */}
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
          </div>

          {/* Add to cart */}
          <AddToCartButton productId={product.id} stock={product.stockQuantity} />

          {/* Trust badges */}
          <div
            className="grid grid-cols-3 gap-3 rounded-xl p-4 text-center text-xs"
            style={{ backgroundColor: 'var(--color-muted)' }}
          >
            <div className="flex flex-col items-center gap-1" style={{ color: 'var(--color-muted-fg)' }}>
              <Package className="h-5 w-5" />
              <span>Ücretsiz Kargo</span>
            </div>
            <div className="flex flex-col items-center gap-1" style={{ color: 'var(--color-muted-fg)' }}>
              <RotateCcw className="h-5 w-5" />
              <span>14 Gün İade</span>
            </div>
            <div className="flex flex-col items-center gap-1" style={{ color: 'var(--color-muted-fg)' }}>
              <Shield className="h-5 w-5" />
              <span>Güvenli Ödeme</span>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="mt-16">
        <Tabs defaultValue="description">
          <TabsList>
            <TabsTrigger value="description">Açıklama</TabsTrigger>
            <TabsTrigger value="specs">Özellikler</TabsTrigger>
            <TabsTrigger value="reviews">Değerlendirmeler</TabsTrigger>
          </TabsList>

          <TabsContent value="description" className="mt-6 max-w-2xl">
            <p className="leading-relaxed" style={{ color: 'var(--color-muted-fg)' }}>
              {product.description ?? 'Açıklama henüz eklenmemiş.'}
            </p>
          </TabsContent>

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

          <TabsContent value="reviews" className="mt-6">
            <p className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>
              Henüz değerlendirme yok. İlk değerlendirmeyi sen yap!
            </p>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
