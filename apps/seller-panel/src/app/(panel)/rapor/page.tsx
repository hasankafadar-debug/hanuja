import type { Metadata } from 'next'
import Link from 'next/link'
import { Button, EmptyState, PageHeader, StatCard } from '@hanuja/ui'
import { BarChart3, Eye, Heart, Package, ShoppingCart, TrendingUp, Users } from 'lucide-react'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { DEFAULT_WEB_URL } from '@hanuja/api/lib/platform-info'
import { createProductAnalyticsService } from '@hanuja/api/services/product-analytics.service'
import { createStoreFollowService } from '@hanuja/api/services/store-follow.service'
import { resolveReportingDateRange } from '@hanuja/api/lib/reporting-time'
import { getSellerFromSession } from '@/lib/seller-session'
import { ReportTableClient } from './_components/report-table-client'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Rapor' }

interface Props {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}

function getSingleValue(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value
}

export default async function SellerReportPage({ searchParams }: Props) {
  const resolvedSearchParams = (await searchParams) ?? {}
  const { seller } = await getSellerFromSession()
  const range = resolveReportingDateRange({
    from: getSingleValue(resolvedSearchParams.from),
    to: getSingleValue(resolvedSearchParams.to),
  })
  const { from, to } = range

  const [report, followerCount] = await Promise.all([
    createProductAnalyticsService({ prisma: createPrismaForRoute() }).getSellerProductReport({
      sellerId: seller.id,
      from,
      to,
    }),
    createStoreFollowService({ prisma: createPrismaForRoute() }).getFollowerCount(seller.id),
  ])

  const topViewedProduct = report.topViewedProduct

  return (
    <div className="space-y-6" data-testid="seller-report-page">
      <PageHeader
        title="Rapor"
        description="Urun bazinda favori, sepet, goruntuleme ve satis donusumu."
      />

      <form
        className="grid gap-3 rounded-xl border p-4 md:grid-cols-[1fr,1fr,auto,auto]"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
      >
        <input
          id="report-from"
          type="date"
          name="from"
          aria-label="Baslangic tarihi"
          defaultValue={range.fromKey}
          className="h-10 rounded-lg border px-3 text-sm"
          style={{
            borderColor: 'var(--color-border)',
            backgroundColor: 'var(--color-surface)',
            color: 'var(--color-primary)',
          }}
        />
        <input
          id="report-to"
          type="date"
          name="to"
          aria-label="Bitis tarihi"
          defaultValue={range.toKey}
          className="h-10 rounded-lg border px-3 text-sm"
          style={{
            borderColor: 'var(--color-border)',
            backgroundColor: 'var(--color-surface)',
            color: 'var(--color-primary)',
          }}
        />
        <Button type="submit" size="sm">
          Filtreyi uygula
        </Button>
        <Button asChild type="button" variant="ghost" size="sm">
          <Link href="/rapor">Temizle</Link>
        </Button>
      </form>

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-6">
        <StatCard
          title="Goruntuleyen"
          value={report.totals.viewedCustomerCount}
          icon={<Eye className="h-5 w-5" />}
        />
        <StatCard
          title="Favorileyen"
          value={report.totals.favoritedCustomerCount}
          icon={<Heart className="h-5 w-5" />}
        />
        <StatCard
          title="Sepete Ekleyen"
          value={report.totals.cartCustomerCount}
          icon={<ShoppingCart className="h-5 w-5" />}
        />
        <StatCard
          title="Satisa Donen"
          value={report.totals.convertedCustomerCount}
          icon={<TrendingUp className="h-5 w-5" />}
        />
        <StatCard
          title="En Cok Goruntulenen"
          value={topViewedProduct?.name ?? 'Veri yok'}
          icon={<BarChart3 className="h-5 w-5" />}
        />
        <StatCard
          title="Takipci"
          value={followerCount}
          icon={<Users className="h-5 w-5" />}
        />
      </div>

      <section
        className="overflow-hidden rounded-xl border"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
      >
        {report.rows.length === 0 ? (
          <div className="p-12">
            <EmptyState
              icon={<Package className="h-10 w-10" />}
              title="Raporlanacak urun yok"
              description="Urunleriniz olustugunda rapor satirlari burada gorunur."
            />
          </div>
        ) : (
          <ReportTableClient
            rows={report.rows}
            webUrl={(process.env.NEXT_PUBLIC_WEB_URL ?? DEFAULT_WEB_URL).replace(/\/$/, '')}
          />
        )}
      </section>
    </div>
  )
}
