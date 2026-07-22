import type { Metadata } from 'next'
import Link from 'next/link'
import { Button, EmptyState, Input, PageHeader } from '@hanuja/ui'
import { Download, Plus, Package } from 'lucide-react'
import { getSellerFromSession } from '@/lib/seller-session'
import { createCatalogService } from '@hanuja/api/services/catalog.service'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import ProductsTableClient from './_components/products-table-client'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Urunlerim' }

export default async function ProductsPage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string | string[] }>
}) {
  const { seller } = await getSellerFromSession()
  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const rawQuery = resolvedSearchParams?.q
  const query = (Array.isArray(rawQuery) ? rawQuery[0] : rawQuery)?.trim() ?? ''

  const svc = createCatalogService({ prisma: createPrismaForRoute() })
  const products = await svc.listBySeller(seller.id, undefined, 0, 50, query)

  const rows = products.map((p) => ({
    id: p.id,
    name: p.name,
    modelCode: p.modelCode,
    status: p.status,
    price: typeof (p.price as unknown as { toNumber?: () => number }).toNumber === 'function'
      ? (p.price as unknown as { toNumber: () => number }).toNumber()
      : Number(p.price),
    stockQuantity:
      p.variants.length > 0
        ? p.variants.reduce((sum, variant) => sum + variant.stockQuantity, 0)
        : (p.stockQuantity ?? 0),
    images: p.images as Array<{ url: string }>,
    variants: p.variants.map((variant) => ({
      id: variant.id,
      name: variant.name,
      barcode: variant.barcode,
      price:
        variant.price && typeof (variant.price as unknown as { toNumber?: () => number }).toNumber === 'function'
          ? (variant.price as unknown as { toNumber: () => number }).toNumber()
          : variant.price === null
            ? null
            : Number(variant.price),
      stockQuantity: variant.stockQuantity,
      options:
        variant.options && typeof variant.options === 'object' && !Array.isArray(variant.options)
          ? (variant.options as Record<string, string>)
          : {},
    })),
  }))

  return (
    <div className="space-y-6">
      <PageHeader
        title="Urunlerim"
        description={`${rows.length} urun`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline" className="gap-1.5">
              <Link href="/api/seller/products/export" prefetch={false}>
                <Download className="h-4 w-4" />
                Excel indir
              </Link>
            </Button>
            <Button asChild className="gap-1.5">
              <Link href="/urunler/yeni">
                <Plus className="h-4 w-4" />
                Yeni Urun
              </Link>
            </Button>
          </div>
        }
      />

      <div className="rounded-xl border px-4 py-3 text-sm" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
        Fiyat ve Stok sutunlarindaki hucrelere tiklayarak hizlica guncelleme yapabilirsiniz.
      </div>

      <form className="flex max-w-xl gap-2" action="/urunler" method="get">
        <Input
          name="q"
          defaultValue={query}
          placeholder="Urun adi, SKU, Model Kodu veya barkod ara"
          aria-label="Urun ara"
        />
        <Button type="submit" variant="outline">Ara</Button>
        {query ? <Button asChild type="button" variant="ghost"><Link href="/urunler">Temizle</Link></Button> : null}
      </form>

      {rows.length === 0 ? (
        <EmptyState
          icon={<Package className="h-10 w-10" />}
          title="Henuz urun yok"
          description="Ilk urununuzu ekleyin."
        />
      ) : (
        <ProductsTableClient initialRows={rows} />
      )}
    </div>
  )
}
