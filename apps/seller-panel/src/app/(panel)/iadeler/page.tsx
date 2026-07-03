import type { Metadata } from 'next'
import Link from 'next/link'
import { StatusBadge, PageHeader, EmptyState } from '@hanuja/ui'
import { RotateCcw } from 'lucide-react'
import { getSellerFromSession } from '@/lib/seller-session'
import { createReturnRequestRepository } from '@hanuja/api/repositories/return-request.repository'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { formatOrderDisplayNumber } from '@hanuja/api/lib/order-number'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'İadeler' }

export default async function SellerReturnsPage() {
  const { seller } = await getSellerFromSession()

  const returnRepo = createReturnRequestRepository(createPrismaForRoute())
  const returns = await returnRepo.listForSeller({ sellerId: seller.id })

  return (
    <div className="space-y-6">
      <PageHeader title="İadeler" description={`${returns.length} iade talebi`} />

      <div
        className="rounded-xl border p-4 text-sm"
        style={{ borderColor: 'var(--color-border)', backgroundColor: '#fff7ed' }}
      >
        <p style={{ color: '#9a3412' }}>
          <strong>Hatırlatma:</strong> Açık iade durumunda hakedişiniz bloke edilir. Detaydan iade
          kargo bilgisini girin; ürün size ulaştığında onaylayın veya yanlış ürün gelmişse
          reddedin. Reddederseniz konu admin uyuşmazlık incelemesine taşınır.
        </p>
      </div>

      {returns.length === 0 ? (
        <EmptyState
          icon={<RotateCcw className="h-10 w-10" />}
          title="Açık iade yok"
          description="İade talepleri burada görünecek."
        />
      ) : (
        <div
          className="rounded-xl border overflow-hidden"
          style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
        >
          <table className="w-full text-sm">
            <thead style={{ backgroundColor: 'var(--color-muted)' }}>
              <tr>
                {['İade No', 'Sipariş', 'Ürün', 'Sebep', 'Talep Tarihi', '14 Gün?', 'Durum', ''].map((h) => (
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
              {returns.map((r) => {
                const productName = r.order.lines[0]?.product?.name ?? 'Ürün'
                const requestedAt = new Date(r.createdAt).toLocaleDateString('tr-TR', {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                })
                return (
                  <tr
                    key={r.id}
                    className="border-t"
                    style={{ borderColor: 'var(--color-border)' }}
                  >
                    <td className="px-4 py-3 font-medium font-mono text-xs" style={{ color: 'var(--color-primary)' }}>
                      #{r.id.slice(-8).toUpperCase()}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/siparisler/${r.orderId}`}
                        className="hover:underline font-mono text-xs"
                        style={{ color: 'var(--color-accent)' }}
                      >
                        {formatOrderDisplayNumber(r.order.publicNumber, r.orderId)}
                      </Link>
                    </td>
                    <td className="px-4 py-3" style={{ color: 'var(--color-muted-fg)' }}>
                      {productName}
                    </td>
                    <td className="px-4 py-3" style={{ color: 'var(--color-muted-fg)' }}>
                      {r.reason}
                    </td>
                    <td className="px-4 py-3" style={{ color: 'var(--color-muted-fg)' }}>
                      {requestedAt}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className="text-xs font-medium"
                        style={{
                          color: r.isWithinWindow ? 'var(--color-success)' : 'var(--color-warning)',
                        }}
                      >
                        {r.isWithinWindow ? '✓ 14 Gün İçinde' : '✗ 14 Gün Sonrası'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={r.status as Parameters<typeof StatusBadge>[0]['status']} />
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/iadeler/${r.id}`}
                        className="text-xs font-medium hover:underline"
                        style={{ color: 'var(--color-accent)' }}
                      >
                        Detay
                      </Link>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
