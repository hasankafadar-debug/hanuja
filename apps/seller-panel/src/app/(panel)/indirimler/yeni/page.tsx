import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { PageHeader } from '@hanuja/ui'
import { createCatalogService } from '@hanuja/api/services/catalog.service'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { getSellerFromSession } from '@/lib/seller-session'
import { buildCategoryOptions } from '../../urunler/_lib/category-options'
import { DiscountRuleForm } from '../_components/discount-rule-form'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Yeni İndirim',
}

export default async function NewDiscountPage() {
  const { seller } = await getSellerFromSession()
  const catalogService = createCatalogService({ prisma: createPrismaForRoute() })

  const [categories, products] = await Promise.all([
    catalogService.listAllCategories(),
    catalogService.listBySeller(seller.id, undefined, 0, 100),
  ])

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <Link
          href="/indirimler"
          className="mb-4 inline-flex items-center gap-1.5 text-sm"
          style={{ color: 'var(--color-muted-fg)' }}
        >
          <ArrowLeft className="h-4 w-4" />
          İndirimlere Dön
        </Link>
        <PageHeader
          title="Yeni İndirim"
          description="Ürün veya kategori bazlı yeni bir kampanya tanımlayın."
        />
      </div>

      <DiscountRuleForm
        categories={buildCategoryOptions(
          categories as unknown as Array<{ id: string; name: string; parentId: string | null }>,
        )}
        products={(products as Array<{ id: string; name: string }>).map((product) => ({
          id: product.id,
          name: product.name,
        }))}
      />
    </div>
  )
}
