import type { Metadata } from 'next'
import Link from 'next/link'
import { Button, EmptyState, PageHeader } from '@hanuja/ui'
import { Percent, Plus } from 'lucide-react'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { createDiscountService } from '@hanuja/api/services/discount.service'
import { getSellerFromSession } from '@/lib/seller-session'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Indirimler',
}

function formatDiscountValue(type: string, value: { toNumber(): number } | number) {
  const numericValue = typeof value === 'object' ? value.toNumber() : Number(value)
  return type === 'PERCENT' ? `%${numericValue}` : `TL ${numericValue.toLocaleString('tr-TR')}`
}

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Aktif',
  SCHEDULED: 'Planli',
  EXPIRED: 'Bitmis',
  PAUSED: 'Duraklatildi',
}

export default async function DiscountsPage() {
  const { seller } = await getSellerFromSession()
  const discountService = createDiscountService({ prisma: createPrismaForRoute() })
  const rules = await discountService.listRules(seller.id)

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
    </div>
  )
}
