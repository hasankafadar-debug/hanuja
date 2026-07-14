import type { Metadata } from 'next'
import Link from 'next/link'
import { Button, EmptyState, PageHeader, StatusBadge } from '@hanuja/ui'
import { Percent, Plus, Ticket } from 'lucide-react'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { createDiscountService } from '@hanuja/api/services/discount.service'
import { createCouponService } from '@hanuja/api/services/coupon.service'
import { formatMoney } from '@hanuja/security'
import { getSellerFromSession } from '@/lib/seller-session'
import { CouponToggle } from './_components/coupon-toggle'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Indirimler',
}

function formatDiscountValue(type: string, value: { toNumber(): number } | number) {
  const numericValue = typeof value === 'object' ? value.toNumber() : Number(value)
  return type === 'PERCENT'
    ? `%${numericValue}`
    : `${numericValue.toLocaleString('tr-TR', { maximumFractionDigits: 0 })} TL`
}

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Aktif',
  SCHEDULED: 'Planli',
  EXPIRED: 'Bitmis',
  PAUSED: 'Duraklatildi',
}

function toNum(value: unknown): number {
  if (value === null || value === undefined) return 0
  if (typeof value === 'object' && 'toNumber' in (value as object)) {
    return (value as { toNumber(): number }).toNumber()
  }
  return Number(value)
}

function formatCouponValue(type: string, value: unknown): string {
  const numeric = toNum(value)
  return type === 'percentage'
    ? `%${numeric.toLocaleString('tr-TR', { maximumFractionDigits: 2 })}`
    : formatMoney(numeric)
}

interface CouponRow {
  id: string
  code: string
  discountType: string
  discountValue: unknown
  usageCount: number
  maxUsageTotal: number | null
  expiresAt: Date | null
  isActive: boolean
}

export default async function DiscountsPage() {
  const { seller } = await getSellerFromSession()
  const prisma = createPrismaForRoute()
  const discountService = createDiscountService({ prisma })
  const couponService = createCouponService({ prisma })
  const [rules, couponsRaw] = await Promise.all([
    discountService.listRules(seller.id),
    couponService.listBySeller(seller.id, { take: 100 }),
  ])
  const coupons = couponsRaw as unknown as CouponRow[]
  const now = new Date()

  return (
    <div className="space-y-6">
      <PageHeader
        title="Indirimler"
        description={`${rules.length} kural`}
        actions={
          <Link href="/indirimler/yeni">
            <Button className="gap-1.5">
              <Plus className="h-4 w-4" />
              Yeni Indirim
            </Button>
          </Link>
        }
      />

      {rules.length === 0 ? (
        <EmptyState
          icon={<Percent className="h-10 w-10" />}
          title="Henuz indirim kurali yok"
          description="Ilk kampanyanizi olusturup urunlerinize indirim uygulayin."
        />
      ) : (
        <div className="overflow-hidden rounded-xl border" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
          <table className="w-full text-sm">
            <thead style={{ backgroundColor: 'var(--color-muted)' }}>
              <tr>
                {['Kural', 'Kapsam', 'Deger', 'Durum', 'Tarih', ''].map((heading) => (
                  <th key={heading} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-muted-fg)' }}>
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => (
                <tr key={rule.id} className="border-t" style={{ borderColor: 'var(--color-border)' }}>
                  <td className="px-4 py-3">
                    <div className="font-medium" style={{ color: 'var(--color-primary)' }}>
                      {rule.name}
                    </div>
                  </td>
                  <td className="px-4 py-3">{rule.scope}</td>
                  <td className="px-4 py-3">{formatDiscountValue(rule.type, rule.value)}</td>
                  <td className="px-4 py-3">{STATUS_LABELS[rule.liveStatus] ?? rule.liveStatus}</td>
                  <td className="px-4 py-3">
                    {rule.startsAt ? new Date(rule.startsAt).toLocaleDateString('tr-TR') : 'Hemen baslar'}
                    {' - '}
                    {rule.endsAt ? new Date(rule.endsAt).toLocaleDateString('tr-TR') : 'Suresiz'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/indirimler/${rule.id}`}>
                      <Button variant="outline" size="sm">Kampanyayi Yonet</Button>
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <section className="space-y-4 pt-2">
        <PageHeader
          title="Kuponlar"
          description="Müşterilerin ödeme adımında girdiği indirim kodları"
          actions={
            <Link href="/indirimler/kupon/yeni">
              <Button className="gap-1.5">
                <Plus className="h-4 w-4" />
                Kupon Oluştur
              </Button>
            </Link>
          }
        />

        {coupons.length === 0 ? (
          <EmptyState
            icon={<Ticket className="h-10 w-10" />}
            title="Henüz kupon yok"
            description="Kupon yalnız sizin ürünlerinizde geçerlidir ve indirim tutarı hakedişinizden düşülür."
          />
        ) : (
          <div
            className="overflow-x-auto rounded-xl border"
            style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
          >
            <table className="w-full whitespace-nowrap text-sm">
              <thead style={{ backgroundColor: 'var(--color-muted)' }}>
                <tr>
                  {['Kod', 'Tip / Değer', 'Kullanım', 'Son Geçerlilik', 'Durum', ''].map((heading) => (
                    <th
                      key={heading || 'aksiyon'}
                      className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide"
                      style={{ color: 'var(--color-muted-fg)' }}
                    >
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {coupons.map((coupon) => {
                  const isExpired = Boolean(coupon.expiresAt && new Date(coupon.expiresAt) < now)
                  const statusLabel = isExpired ? 'Süresi Doldu' : coupon.isActive ? 'Aktif' : 'Pasif'
                  const statusBadgeStatus = isExpired
                    ? 'expired'
                    : coupon.isActive
                      ? 'active'
                      : 'inactive'
                  return (
                    <tr key={coupon.id} className="border-t" style={{ borderColor: 'var(--color-border)' }}>
                      <td className="px-4 py-3 font-mono font-medium" style={{ color: 'var(--color-primary)' }}>
                        {coupon.code}
                      </td>
                      <td className="px-4 py-3" style={{ color: 'var(--color-muted-fg)' }}>
                        {formatCouponValue(coupon.discountType, coupon.discountValue)}
                      </td>
                      <td className="px-4 py-3" style={{ color: 'var(--color-muted-fg)' }}>
                        {coupon.usageCount}
                        {coupon.maxUsageTotal !== null ? ` / ${coupon.maxUsageTotal}` : ' / Sınırsız'}
                      </td>
                      <td className="px-4 py-3" style={{ color: 'var(--color-muted-fg)' }}>
                        {coupon.expiresAt
                          ? new Date(coupon.expiresAt).toLocaleDateString('tr-TR')
                          : 'Süresiz'}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge
                          status={statusBadgeStatus as Parameters<typeof StatusBadge>[0]['status']}
                          label={statusLabel}
                        />
                      </td>
                      <td className="px-4 py-3 text-right">
                        {isExpired ? null : <CouponToggle couponId={coupon.id} isActive={coupon.isActive} />}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
