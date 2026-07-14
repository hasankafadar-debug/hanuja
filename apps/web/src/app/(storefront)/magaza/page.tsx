import type { Metadata } from 'next'
import Link from 'next/link'
import { Store } from 'lucide-react'
import { Breadcrumb, normalizeMediaDisplayUrl } from '@hanuja/ui'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { createSellerRepository } from '@hanuja/api/repositories/seller.repository'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Mağazalar',
  description: 'Hanuja üzerindeki aktif mağazaları keşfedin.',
}

export default async function StoresPage() {
  const sellerRepo = createSellerRepository(createPrismaForRoute())
  const sellers = await sellerRepo.listActiveForStorefront()

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <Breadcrumb
        items={[
          { label: 'Anasayfa', href: '/' },
          { label: 'Mağazalar' },
        ]}
        className="mb-8"
      />

      <div className="mb-8 flex items-center gap-3">
        <Store className="h-6 w-6" style={{ color: 'var(--color-accent)' }} />
        <div>
          <h1 className="text-2xl font-medium" style={{ color: '#3d3529' }}>
            Mağazalar
          </h1>
          <p className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>
            Aktif satıcı mağazalarını buradan keşfedebilirsiniz.
          </p>
        </div>
      </div>

      {sellers.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>
          Henüz yayınlanmış mağaza bulunmuyor.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sellers.map((seller) => {
            const logoUrl = seller.profile?.logoUrl
              ? normalizeMediaDisplayUrl(seller.profile.logoUrl)
              : null
            return (
              <Link
                key={seller.id}
                href={`/magaza/${seller.slug}`}
                className="rounded-xl border p-5 transition-shadow hover:shadow-md"
                style={{
                  borderColor: 'var(--color-border)',
                  backgroundColor: 'var(--color-surface)',
                }}
              >
                <div className="flex items-center gap-4">
                  <div
                    className="flex h-14 w-14 items-center justify-center rounded-2xl text-lg font-semibold text-white"
                    style={{
                      backgroundColor: logoUrl ? undefined : 'var(--color-accent)',
                      backgroundImage: logoUrl ? `url("${logoUrl}")` : undefined,
                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                    }}
                  >
                    {!logoUrl && seller.displayName.charAt(0)}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate font-semibold" style={{ color: 'var(--color-primary)' }}>
                      {seller.displayName}
                    </p>
                    <p className="truncate text-sm" style={{ color: 'var(--color-muted-fg)' }}>
                      /magaza/{seller.slug}
                    </p>
                  </div>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
