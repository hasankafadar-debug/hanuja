import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { PageHeader } from '@hanuja/ui'
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

  const svc = createCatalogService({ prisma: createPrismaForRoute() })
  const product = await svc.getProductForSeller(id, seller.id).catch(() => null)

  if (!product) notFound()

  type ProductImage = { id: string; url: string; altText?: string | null }
  type ProductData = {
    id: string
    name: string
    description: string | null
    price: { toNumber(): number } | number
    stockQuantity: number | null
    status: string
    images?: ProductImage[]
  }

  const p = product as unknown as ProductData
  const price = typeof p.price === 'object' ? p.price.toNumber() : Number(p.price)
  const existingImages = (p.images ?? []).map((img) => ({
    id: img.id,
    url: img.url,
    key: img.id, // key used by FileUpload UploadedAsset type
  }))

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
        initialPrice={price}
        initialStock={p.stockQuantity ?? 0}
        initialStatus={p.status}
        existingImages={existingImages}
      />
    </div>
  )
}
