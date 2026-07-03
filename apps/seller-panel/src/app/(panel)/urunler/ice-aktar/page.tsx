import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { PageHeader } from '@hanuja/ui'
import { getSellerFromSession } from '@/lib/seller-session'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { createCatalogService } from '@hanuja/api/services/catalog.service'
import { buildCategoryOptions } from '../_lib/category-options'
import { ImportForm } from './_components/import-form'
import {
  ImportPermissionPending,
  ImportPermissionRequest,
} from './_components/import-permission-request'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: "Hipicon'dan İçe Aktar",
}

interface CategoryRow {
  id: string
  slug: string
  name: string
  parentId: string | null
}

export default async function SellerImportPage() {
  const { seller } = await getSellerFromSession()
  const prisma = createPrismaForRoute()
  const catalogSvc = createCatalogService({ prisma })
  const allCategories = await catalogSvc.listAllCategories()
  const categories = buildCategoryOptions(allCategories as CategoryRow[])

  return (
    <div className="max-w-6xl space-y-6">
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
          title="Hipicon'dan İçe Aktar"
          description={`${seller.displayName} mağazasına Hipicon mağaza URL'si ile ürün çek.`}
        />
      </div>

      {seller.importEnabled ? (
        <ImportForm categories={categories} sellerNumber={seller.sellerNumber} />
      ) : seller.importRequestedAt ? (
        <ImportPermissionPending requestedAt={seller.importRequestedAt} />
      ) : (
        <ImportPermissionRequest />
      )}
    </div>
  )
}
