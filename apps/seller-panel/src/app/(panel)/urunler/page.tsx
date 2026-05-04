import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { Button, Badge, PageHeader, EmptyState, normalizeMediaDisplayUrl } from '@hanuja/ui'
import { Plus, Package } from 'lucide-react'
import { getSellerFromSession } from '@/lib/seller-session'
import { createCatalogService } from '@hanuja/api/services/catalog.service'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Ürünlerim' }

const STATUS_MAP: Record<string, { label: string; variant: 'success' | 'warning' | 'secondary' | 'destructive' }> = {
  published: { label: 'Aktif', variant: 'success' },
  draft: { label: 'Taslak', variant: 'secondary' },
  pending_review: { label: 'İncelemede', variant: 'warning' },
  unlisted: { label: 'Yayından Kaldırıldı', variant: 'destructive' },
  rejected: { label: 'Reddedildi', variant: 'destructive' },
}

export default async function ProductsPage() {
  const { seller } = await getSellerFromSession()

  const svc = createCatalogService({ prisma: createPrismaForRoute() })
  const products = await svc.listBySeller(seller.id, undefined, 0, 50)

  type ProductRow = {
    id: string
    name: string
    status: string
    price: { toNumber(): number } | number
    stockQuantity: number | null
    images: Array<{ url: string }>
    category?: { name: string } | null
  }

  const rows = products as unknown as ProductRow[]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Ürünlerim"
        description={`${rows.length} ürün`}
        actions={
          <Link href="/urunler/yeni">
            <Button className="gap-1.5">
              <Plus className="h-4 w-4" />
              Yeni Ürün
            </Button>
          </Link>
        }
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={<Package className="h-10 w-10" />}
          title="Henüz ürün yok"
          description="İlk ürününüzü ekleyin."
        />
      ) : (
        <div
          className="rounded-xl border overflow-hidden"
          style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
        >
          <table className="w-full text-sm">
            <thead style={{ backgroundColor: 'var(--color-muted)' }}>
              <tr>
                {['Ürün', 'Fiyat', 'Stok', 'Durum', ''].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide"
                    style={{ color: 'var(--color-muted-fg)' }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((product) => {
                const price = typeof product.price === 'object' ? product.price.toNumber() : Number(product.price)
                const stock = product.stockQuantity ?? 0
                const statusInfo = STATUS_MAP[product.status] ?? { label: product.status, variant: 'secondary' as const }
                const imageUrl = product.images?.[0]?.url
                  ? normalizeMediaDisplayUrl(product.images[0].url)
                  : null

                return (
                  <tr
                    key={product.id}
                    className="border-t transition-colors hover:bg-[var(--color-muted)]"
                    style={{ borderColor: 'var(--color-border)' }}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div
                          className="h-10 w-10 shrink-0 rounded-lg overflow-hidden relative flex items-center justify-center"
                          style={{ backgroundColor: 'var(--color-muted)', color: 'var(--color-muted-fg)' }}
                        >
                          {imageUrl ? (
                            <Image src={imageUrl} alt={product.name} fill className="object-cover" />
                          ) : (
                            <Package className="h-4 w-4" />
                          )}
                        </div>
                        <span className="font-medium" style={{ color: 'var(--color-primary)' }}>
                          {product.name}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 font-medium" style={{ color: 'var(--color-primary)' }}>
                      ₺{price.toLocaleString('tr-TR')}
                    </td>
                    <td
                      className="px-4 py-3"
                      style={{ color: stock === 0 ? 'var(--color-destructive)' : 'var(--color-muted-fg)' }}
                    >
                      {stock}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/urunler/${product.id}`}
                        className="text-xs hover:underline"
                        style={{ color: 'var(--color-accent)' }}
                      >
                        Düzenle
                      </Link>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
