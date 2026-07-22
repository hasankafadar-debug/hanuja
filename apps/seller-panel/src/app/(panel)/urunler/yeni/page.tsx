import type { Metadata } from 'next'
import Link from 'next/link'
import { PageHeader } from '@hanuja/ui'
import { ArrowLeft } from 'lucide-react'
import { getSellerFromSession } from '@/lib/seller-session'
import { createCatalogService } from '@hanuja/api/services/catalog.service'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import NewProductForm from './_components/new-product-form'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Yeni Ürün Ekle' }

export default async function NewProductPage() {
  await getSellerFromSession() // auth guard

  const svc = createCatalogService({ prisma: createPrismaForRoute() })
  const allCategories = await svc.listAllCategories()

  const categories = allCategories.map((category) => ({
    id: category.id,
    name: category.name,
    parentId: category.parentId,
  }))

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <Link
          href="/urunler"
          className="mb-4 inline-flex items-center gap-1.5 text-sm"
          style={{ color: 'var(--color-muted-fg)' }}
        >
          <ArrowLeft className="h-4 w-4" /> Ürünlere Dön
        </Link>
        <PageHeader title="Yeni Ürün Ekle" description="Mağazanıza yeni bir ürün ekleyin" />
      </div>

      <NewProductForm categories={categories} />
    </div>
  )
}
