import type { Metadata } from 'next'
import Link from 'next/link'
import { Button, EmptyState, PageHeader, StatCard } from '@hanuja/ui'
import { BarChart3, Eye, Heart, Package, ShoppingCart, TrendingUp, Users } from 'lucide-react'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { DEFAULT_WEB_URL } from '@hanuja/api/lib/platform-info'
import { createProductAnalyticsService } from '@hanuja/api/services/product-analytics.service'
import { createStoreFollowService } from '@hanuja/api/services/store-follow.service'
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

function formatDateInput(date: Date) {
  const year = date.getUTCFullYear()
  const month = `${date.getUTCMonth() + 1}`.padStart(2, '0')
  const day = `${date.getUTCDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

function parseDateInput(value: string | undefined, fallback: Date, endOfDay: boolean) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(fallback)
  const parsed = new Date(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`)
  if (Number.isNaN(parsed.getTime())) return new Date(fallback)
  return parsed
}

function getDefaultRange() {
  const now = new Date()
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999))
  const from = new Date(to)
  from.setUTCDate(from.getUTCDate() - 29)
  from.setUTCHours(0, 0, 0, 0)
  return { from, to }
}

export default async function SellerReportPage({ searchParams }: Props) {
  const resolvedSearchParams = (await searchParams) ?? {}
  const { seller } = await getSellerFromSession()
  const defaults = getDefaultRange()

  let from = parseDateInput(getSingleValue(resolvedSearchParams.from), defaults.from, false)
  let to = parseDateInput(getSingleValue(resolvedSearchParams.to), defaults.to, true)

  if (from > to) {
    const previousFrom = from
    from = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate(), 0, 0, 0, 0))
    to = new Date(Date.UTC(previousFrom.getUTCFullYear(), previousFrom.getUTCMonth(), previousFrom.getUTCDate(), 23, 59, 59, 999))
  }

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
          defaultValue={formatDateInput(from)}
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
          defaultValue={formatDateInput(to)}
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
