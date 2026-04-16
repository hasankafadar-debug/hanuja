import type { Metadata } from 'next'
import Link from 'next/link'
import { PageHeader } from '@hanuja/ui'
import { getAdminSession } from '@/lib/admin-session'
import { WaivePenaltyButton } from '@/components/waive-penalty-button'
import { createPenaltyService } from '@hanuja/api/services/penalty.service'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Cezalar' }

const REASON_MAP: Record<string, string> = {
  seller_rejected_paid_order: 'Sipariş reddi',
  fulfillment_20day_breach: '20 gün taahhüt ihlali',
  other: 'Diğer',
}

export default async function PenaltiesPage() {
  await getAdminSession()

  const prisma = createPrismaForRoute()
  const svc = createPenaltyService({ prisma })
  const penalties = await svc.listForAdmin({ skip: 0, take: 50 })

  type PenaltyRow = {
    id: string
    orderId: string
    sellerId: string
    reason: string
    status: string
    penaltyAmount: { toNumber(): number } | number
    createdAt: Date
    waivedAt: Date | null
    seller: { profile: { storeName: string } | null } | null
  }

  const rows = penalties as unknown as PenaltyRow[]

  return (
    <div className="space-y-6">
      <PageHeader title="Cezalar" description={`${rows.length} ceza kaydı`} />

      <div
        className="rounded-xl border p-4 text-sm"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-muted)' }}
      >
        <strong style={{ color: 'var(--color-primary)' }}>Standart ceza oranı:</strong>{' '}
        <span style={{ color: 'var(--color-muted-fg)' }}>
          Ürün tutarının %20'si. Satıcı cari hesabına borç kaydedilir ve gelecek hakedişlerden mahsup edilir.
          İstisnai durumlarda yetkili admin muafiyet uygulayabilir.
        </span>
      </div>

      <div
        className="rounded-xl border overflow-x-auto"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
      >
        {rows.length === 0 ? (
          <p className="p-6 text-center text-sm" style={{ color: 'var(--color-muted-fg)' }}>
            Ceza kaydı yok.
          </p>
        ) : (
          <table className="w-full text-sm whitespace-nowrap">
            <thead style={{ backgroundColor: 'var(--color-muted)' }}>
              <tr>
                {['Sipariş', 'Satıcı', 'Tutar', 'Sebep', 'Tarih', 'Durum', ''].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide"
                    style={{ color: 'var(--color-muted-fg)' }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const amount = typeof p.penaltyAmount === 'number' ? p.penaltyAmount : p.penaltyAmount.toNumber()
                const storeName = p.seller?.profile?.storeName ?? p.sellerId.slice(0, 8)
                const waived = p.status === 'waived'

                return (
                  <tr
                    key={p.id}
                    className="border-t hover:bg-[var(--color-muted)]"
                    style={{ borderColor: 'var(--color-border)' }}
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/siparisler/${p.orderId}`}
                        className="hover:underline"
                        style={{ color: 'var(--color-accent)' }}
                      >
                        {p.orderId.slice(-8).toUpperCase()}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/saticilar/${p.sellerId}`}
                        className="hover:underline"
                        style={{ color: 'var(--color-accent)' }}
                      >
                        {storeName}
                      </Link>
                    </td>
                    <td
                      className="px-4 py-3 font-medium"
                      style={{ color: waived ? 'var(--color-muted-fg)' : 'var(--color-destructive)' }}
                    >
                      {waived ? (
                        <s>₺{amount.toLocaleString('tr-TR')}</s>
                      ) : (
                        `₺${amount.toLocaleString('tr-TR')}`
                      )}
                    </td>
                    <td className="px-4 py-3" style={{ color: 'var(--color-muted-fg)' }}>
                      {REASON_MAP[p.reason] ?? p.reason}
                    </td>
                    <td className="px-4 py-3" style={{ color: 'var(--color-muted-fg)' }}>
                      {new Date(p.createdAt).toLocaleDateString('tr-TR', {
                        day: 'numeric', month: 'short', year: 'numeric',
                      })}
                    </td>
                    <td className="px-4 py-3">
                      {waived ? (
                        <span className="text-xs font-medium" style={{ color: 'var(--color-success)' }}>
                          Muaf Tutuldu
                        </span>
                      ) : (
                        <span className="text-xs font-medium" style={{ color: 'var(--color-destructive)' }}>
                          Uygulandı
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {!waived && <WaivePenaltyButton penaltyId={p.id} />}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
