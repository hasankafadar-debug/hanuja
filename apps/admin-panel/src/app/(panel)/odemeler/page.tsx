import type { Metadata } from 'next'
import Link from 'next/link'
import { StatusBadge, PageHeader } from '@hanuja/ui'
import { AlertTriangle } from 'lucide-react'
import { getAdminSession } from '@/lib/admin-session'
import { EftActions } from '@/components/eft-actions'
import { createPaymentService } from '@hanuja/api/services/payment.service'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Ödemeler' }

export default async function AdminPaymentsPage() {
  await getAdminSession()

  const prisma = createPrismaForRoute()
  const svc = createPaymentService({ prisma })
  const pendingEft = await svc.getPendingEftList()

  // Also load recent confirmed payments
  const confirmedPayments = await prisma.payment.findMany({
    where: { status: 'confirmed' },
    include: {
      order: {
        include: {
          lines: {
            include: { product: { include: { seller: { select: { displayName: true } } } } },
          },
        },
      },
    },
    orderBy: { confirmedAt: 'desc' },
    take: 20,
  })

  type EftRow = {
    id: string
    orderId: string
    amount: { toNumber(): number } | number
    createdAt: Date
    order: {
      id: string
      lines: Array<{ product: { seller: { displayName: string } } | null }>
    } | null
  }

  type ConfirmedRow = {
    id: string
    orderId: string
    method: string
    status: string
    amount: { toNumber(): number } | number
    confirmedAt: Date | null
    order: {
      id: string
      lines: Array<{ product: { seller: { displayName: string } } | null }>
    } | null
  }

  const eftRows = pendingEft as unknown as EftRow[]
  const confirmedRows = confirmedPayments as unknown as ConfirmedRow[]

  function getSellerName(lines: Array<{ product: { seller: { displayName: string } } | null }> | undefined) {
    return lines?.[0]?.product?.seller?.displayName ?? '—'
  }

  return (
    <div className="space-y-8" data-testid="admin-payments-page">
      <PageHeader title="Ödemeler" description="EFT onayları ve kart ödemeleri" />

      {/* EFT approval queue */}
      <section>
        <div className="mb-3 flex items-center gap-2">
          <h2 className="font-semibold" style={{ color: 'var(--color-primary)' }}>
            EFT / Havale Onay Kuyruğu
          </h2>
          {eftRows.length > 0 && (
            <span
              className="rounded-full px-2 py-0.5 text-xs font-semibold text-white"
              style={{ backgroundColor: 'var(--color-destructive)' }}
            >
              {eftRows.length}
            </span>
          )}
        </div>

        {eftRows.length === 0 ? (
          <div
            className="rounded-xl border p-6 text-center text-sm"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted-fg)' }}
          >
            Bekleyen EFT/havale yok.
          </div>
        ) : (
          <div className="space-y-3">
            {eftRows.map((eft) => {
              const amount = typeof eft.amount === 'number' ? eft.amount : eft.amount.toNumber()
              const sellerName = getSellerName(eft.order?.lines)
              return (
                <div
                  key={eft.id}
                  className="rounded-xl border p-5"
                  style={{ borderColor: '#fca5a5', backgroundColor: '#fff5f5' }}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4" style={{ color: 'var(--color-destructive)' }} />
                        <span className="font-semibold text-sm" style={{ color: 'var(--color-primary)' }}>
                          {eft.orderId.slice(-8).toUpperCase()} — {sellerName}
                        </span>
                      </div>
                      <p className="mt-1 text-sm" style={{ color: 'var(--color-muted-fg)' }}>
                        ₺{amount.toLocaleString('tr-TR')} ·{' '}
                        {new Date(eft.createdAt).toLocaleString('tr-TR', {
                          day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                        })}
                      </p>
                      <Link
                        href={`/siparisler/${eft.orderId}`}
                        className="mt-1 text-xs hover:underline"
                        style={{ color: 'var(--color-accent)' }}
                      >
                        Sipariş detayı →
                      </Link>
                    </div>
                    <EftActions orderId={eft.orderId} />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* Confirmed payments */}
      <section>
        <h2 className="mb-3 font-semibold" style={{ color: 'var(--color-primary)' }}>
          Onaylı Ödemeler
        </h2>
        <div
          className="rounded-xl border overflow-hidden"
          style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
        >
          {confirmedRows.length === 0 ? (
            <p className="p-6 text-center text-sm" style={{ color: 'var(--color-muted-fg)' }}>
              Onaylı ödeme yok.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead style={{ backgroundColor: 'var(--color-muted)' }}>
                <tr>
                  {['Sipariş', 'Satıcı', 'Yöntem', 'Tutar', 'Durum', 'Tarih'].map((h) => (
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
                {confirmedRows.map((p) => {
                  const amount = typeof p.amount === 'number' ? p.amount : p.amount.toNumber()
                  const sellerName = getSellerName(p.order?.lines)
                  return (
                    <tr
                      key={p.id}
                      className="border-t hover:bg-[var(--color-muted)]"
                      style={{ borderColor: 'var(--color-border)' }}
                    >
                      <td className="px-4 py-3">
                        <Link
                          href={`/siparisler/${p.orderId}`}
                          className="font-medium hover:underline"
                          style={{ color: 'var(--color-accent)' }}
                        >
                          {p.orderId.slice(-8).toUpperCase()}
                        </Link>
                      </td>
                      <td className="px-4 py-3" style={{ color: 'var(--color-muted-fg)' }}>
                        {sellerName}
                      </td>
                      <td className="px-4 py-3 capitalize" style={{ color: 'var(--color-muted-fg)' }}>
                        {p.method === 'eft' ? 'EFT/Havale' : 'Kart'}
                      </td>
                      <td className="px-4 py-3 font-medium" style={{ color: 'var(--color-primary)' }}>
                        ₺{amount.toLocaleString('tr-TR')}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={'payment_confirmed' as never} />
                      </td>
                      <td className="px-4 py-3" style={{ color: 'var(--color-muted-fg)' }}>
                        {p.confirmedAt
                          ? new Date(p.confirmedAt).toLocaleDateString('tr-TR', {
                              day: 'numeric', month: 'short', year: 'numeric',
                            })
                          : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  )
}
