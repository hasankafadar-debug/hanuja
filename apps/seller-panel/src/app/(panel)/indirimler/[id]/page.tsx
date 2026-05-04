import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { PageHeader } from '@hanuja/ui'
import { createCatalogService } from '@hanuja/api/services/catalog.service'
import { createDiscountService } from '@hanuja/api/services/discount.service'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { getSellerFromSession } from '@/lib/seller-session'
import { buildCategoryOptions } from '../../urunler/_lib/category-options'
import { DiscountRuleForm } from '../_components/discount-rule-form'
import { DeleteDiscountButton } from './_components/delete-discount-button'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ id: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params
  return { title: `Kampanya Yonet - ${id.slice(0, 8)}` }
}

export default async function ManageDiscountPage({ params }: Props) {
  const { id } = await params
  const { seller } = await getSellerFromSession()
  const prisma = createPrismaForRoute()
  const discountService = createDiscountService({ prisma })
  const catalogService = createCatalogService({ prisma })

  const [rule, categories, products] = await Promise.all([
    discountService.getRule(seller.id, id),
    catalogService.listAllCategories(),
    catalogService.listBySeller(seller.id, undefined, 0, 100),
  ])

  if (!rule) notFound()

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <Link href="/indirimler" className="mb-4 inline-flex items-center gap-1.5 text-sm" style={{ color: 'var(--color-muted-fg)' }}>
          <ArrowLeft className="h-4 w-4" />
          Indirimlere Don
        </Link>
        <PageHeader
          title="Kampanyayi Yonet"
          description={rule.name}
          actions={<DeleteDiscountButton ruleId={rule.id} />}
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
        initialRule={{
          id: rule.id,
          name: rule.name,
          type: rule.type,
          scope: rule.scope,
          value: typeof rule.value === 'object' ? rule.value.toNumber() : Number(rule.value),
          categoryId: rule.categoryId,
          productIds: rule.products.map((entry) => entry.productId),
          startsAt: rule.startsAt?.toISOString(),
          endsAt: rule.endsAt?.toISOString(),
        }}
      />
    </div>
  )
}
