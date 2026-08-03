import type { Metadata } from 'next'
import Link from 'next/link'
import { Button, StatusBadge, PageHeader } from '@hanuja/ui'
import { getAdminSession } from '@/lib/admin-session'
import { createReturnService } from '@hanuja/api/services/return.service'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { ReturnReviewActions } from './_components/return-review-actions'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'İadeler' }

export default async function ReturnsAdminPage() {
  await getAdminSession()

  const prisma = createPrismaForRoute()
  const svc = createReturnService({ prisma })
  const returns = await svc.listForAdmin({ skip: 0, take: 50 })

  const closedStatuses = ['return_rejected', 'refund_completed']
  const openCount = returns.filter((r) => !closedStatuses.includes(r.status)).length

  const fmt = (d: Date) =>
    d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' })

  return (
    <div className="space-y-6">
      <PageHeader title="İadeler" description={`${openCount} açık iade`} />

      <div
        className="rounded-xl border p-4 text-sm"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-muted)' }}
      >
        <strong style={{ color: 'var(--color-primary)' }}>14-gün kuralı:</strong>{' '}
        <span style={{ color: 'var(--color-muted-fg)' }}>
          14 gün içindeki iadeler yasal cayma hakkı kapsamında hızlı onaylanır. 14 gün sonrası
          iadeler admin değerlendirmesi gerektirir. Açık iade durumunda ilgili siparişin hakedişi
          bloke edilir.
        </span>
      </div>

      <div
        className="overflow-x-auto rounded-xl border"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
      >
        <table className="w-full whitespace-nowrap text-sm">
          <thead style={{ backgroundColor: 'var(--color-muted)' }}>
            <tr>
              {['İade No', 'Sipariş', 'Sebep', 'Talep Tarihi', '14 Gün?', 'Durum', ''].map((h) => (
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
            {returns.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-8 text-center text-sm"
                  style={{ color: 'var(--color-muted-fg)' }}
                >
                  Henüz iade talebi yok.
                </td>
              </tr>
            )}
            {returns.map((r) => (
              <tr
                key={r.id}
                className="border-t hover:bg-[var(--color-muted)]"
                style={{ borderColor: 'var(--color-border)' }}
              >
                <td
                  className="px-4 py-3 font-mono text-xs"
                  style={{ color: 'var(--color-muted-fg)' }}
                >
                  {r.id.slice(0, 8)}…
                </td>
                <td className="px-4 py-3">
                  <Link
                    href={`/siparisler/${r.orderId}`}
                    className="font-medium hover:underline"
                    style={{ color: 'var(--color-accent)' }}
                  >
                    {r.orderId.slice(0, 10)}…
                  </Link>
                </td>
                <td
                  className="max-w-[180px] truncate px-4 py-3"
                  style={{ color: 'var(--color-muted-fg)' }}
                  title={r.reason}
                >
                  {r.reason}
                </td>
                <td className="px-4 py-3" style={{ color: 'var(--color-muted-fg)' }}>
                  {fmt(r.createdAt)}
                </td>
                <td className="px-4 py-3">
                  <span
                    className="text-xs font-medium"
                    style={{
                      color: r.isWithinWindow ? 'var(--color-success)' : 'var(--color-warning)',
                    }}
                  >
                    {r.isWithinWindow ? '✓ Evet' : '✗ Hayır'}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={r.status} />
                </td>
                <td className="px-4 py-3">
                  {r.status === 'under_review' && <ReturnReviewActions returnId={r.id} />}
                  {r.status === 'approved' && (
                    <form action={`/api/admin/returns/${r.id}/mark-received`} method="POST">
                      <input type="hidden" name="refundAmount" value="0" />
                      <Button size="sm" variant="outline" type="submit">
                        Ürün Alındı
                      </Button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
