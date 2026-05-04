import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { PageHeader } from '@hanuja/ui'
import { getSellerFromSession } from '@/lib/seller-session'
import { buildBulkTemplateAreas } from '@/lib/bulk-category-options'
import { createCatalogService } from '@hanuja/api/services/catalog.service'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { BulkImportForm } from './_components/bulk-import-form'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Toplu Ürün Yükle',
}

export default async function BulkUploadPage() {
  await getSellerFromSession()

  const prisma = createPrismaForRoute()
  const catalogSvc = createCatalogService({ prisma })
  const allCategories = await catalogSvc.listAllCategories()
  const areas = buildBulkTemplateAreas(
    allCategories as Array<{ id: string; slug: string; name: string; parentId: string | null; isActive?: boolean | null }>,
  )

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <Link
          href="/urunler"
          className="mb-4 inline-flex items-center gap-1.5 text-sm"
          style={{ color: 'var(--color-muted-fg)' }}
        >
          <ArrowLeft className="h-4 w-4" />
          Ürünlere Dön
        </Link>
        <PageHeader
          title="Toplu Ürün Yükle"
          description="XLSX ile birden fazla ürünü, barkod ve görselleriyle birlikte tek seferde içe aktarın."
        />
      </div>

      <BulkImportForm areas={areas} />
    </div>
  )
}
