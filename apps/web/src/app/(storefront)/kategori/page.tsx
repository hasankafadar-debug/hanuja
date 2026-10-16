import type { Metadata } from 'next'
import { cache } from 'react'
import { buildPublicPageMetadata } from '@hanuja/seo'
import Link from 'next/link'
import { Breadcrumb } from '@hanuja/ui'
import { LayoutGrid } from 'lucide-react'
import { createCatalogService } from '@hanuja/api/services/catalog.service'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'

export const dynamic = 'force-dynamic'

const getRootCategories = cache(async () => {
  const svc = createCatalogService({ prisma: createPrismaForRoute() })
  return svc.listCustomerVisibleRootCategories()
})

export async function generateMetadata(): Promise<Metadata> {
  const categories = await getRootCategories()
  return buildPublicPageMetadata({
    path: '/kategori',
    title: 'Tüm Kategoriler',
    description:
      "Hanuja'daki tüm kategorileri keşfedin; özenle seçilmiş tasarım ürünlerine kategoriye göre göz atın.",
    noindex: categories.length === 0,
  })
}

export default async function KategorilerPage() {
  const categories = await getRootCategories()

  const breadcrumbItems = [{ label: 'Anasayfa', href: '/' }, { label: 'Kategoriler' }]

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <Breadcrumb items={breadcrumbItems} className="mb-8" />

      <div className="mb-8 flex items-center gap-3">
        <LayoutGrid className="h-6 w-6" style={{ color: 'var(--color-accent)' }} />
        <h1 className="text-2xl font-medium" style={{ color: '#3d3529' }}>
          Tüm Kategoriler
        </h1>
      </div>

      {categories.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>
          Henüz kategori bulunmuyor.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {categories.map((cat) => (
            <Link
              key={cat.id}
              href={`/kategori/${cat.slug}`}
              className="group flex flex-col items-center gap-3 rounded-xl border p-5 text-center transition-shadow hover:shadow-md"
              style={{
                borderColor: 'var(--color-border)',
                backgroundColor: 'var(--color-surface)',
              }}
            >
              {/* Placeholder icon — replace with actual category images when available */}
              <div
                className="flex h-14 w-14 items-center justify-center rounded-full text-xl font-bold"
                style={{
                  backgroundColor: 'color-mix(in srgb, var(--color-accent) 12%, transparent)',
                  color: 'var(--color-accent)',
                }}
              >
                {cat.name.charAt(0).toUpperCase()}
              </div>
              <span
                className="text-sm font-medium leading-snug group-hover:underline"
                style={{ color: 'var(--color-primary)' }}
              >
                {cat.name}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
