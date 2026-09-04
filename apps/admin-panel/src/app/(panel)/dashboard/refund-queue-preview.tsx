import Link from 'next/link'
import { AlertTriangle, ArrowUpRight } from 'lucide-react'
import type { AdminRefundQueueRow } from '@hanuja/api/services/admin-refund-query.service'
import { formatOrderDisplayNumber } from '@hanuja/api/lib/order-number'
import {
  CARD_REFUND_RETRY_WARNING,
  formatRefundOutstandingAmount,
  refundSourceLabels,
} from '../../../lib/admin-refund-presentation'

type Props = {
  kind: 'manual' | 'failed_card'
  queue: { rows: AdminRefundQueueRow[]; total: number }
}

export function RefundQueuePreview({ kind, queue }: Props) {
  const manual = kind === 'manual'
  const sectionId = manual ? 'manuel-iadeler' : 'basarisiz-kart-iadeleri'
  const title = manual ? 'Ödeme iadesi bekleyenler' : 'Başarısız kart iadeleri'

  return (
    <section
      id={sectionId}
      aria-labelledby={`${sectionId}-title`}
      className="min-w-0 scroll-mt-6"
      data-testid={sectionId}
    >
      <div className="mb-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h2 id={`${sectionId}-title`} className="font-semibold text-[var(--color-primary)]">
            {title}
          </h2>
          <span className="text-sm tabular-nums text-stone-600">{queue.total} iade işlemi</span>
        </div>
        <p className="mt-1 text-sm text-stone-600">
          {manual
            ? 'Havale / EFT iadeleri ve manuel mutabakat gerektiren diğer iadeler.'
            : 'Tamamlanmamış, hata içeren kart iadeleri.'}
        </p>
      </div>

      {!manual && queue.total > 0 && (
        <div
          className="mb-3 flex gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"
          data-testid="card-refund-failure-warning"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>{CARD_REFUND_RETRY_WARNING}</p>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
        {queue.rows.length === 0 ? (
          <p className="p-6 text-center text-sm text-stone-600">
            {manual ? 'Manuel ödeme iadesi bekleyen işlem yok.' : 'Başarısız kart iadesi yok.'}
          </p>
        ) : (
          <ul className="divide-y divide-[var(--color-border)]">
            {queue.rows.map((refund) => (
              <li key={refund.id} data-testid={`dashboard-refund-${refund.id}`}>
                <Link
                  href={`/siparisler/${refund.orderId}`}
                  prefetch={false}
                  className="block p-4 hover:bg-[var(--color-muted)] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--color-primary)] motion-safe:transition-colors"
                >
                  <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                    <div className="min-w-0 flex-1 basis-40">
                      <p className="break-words text-sm font-medium text-[var(--color-primary)]">
                        {refund.order.customer.name}
                      </p>
                      <p className="mt-0.5 text-sm text-[var(--color-primary)]">
                        {formatOrderDisplayNumber(refund.order.publicNumber, refund.orderId)}
                        {' · '}
                        {refundSourceLabels[refund.sourceType]}
                      </p>
                    </div>
                    <div className="max-w-full text-right">
                      <p className="text-xs text-stone-600">Kalan iade</p>
                      <p className="break-words text-sm font-semibold tabular-nums text-[var(--color-primary)]">
                        {formatRefundOutstandingAmount(
                          refund.outstandingAmount,
                          refund.order.currency,
                        )}
                      </p>
                    </div>
                  </div>
                  <p className="mt-2 text-xs text-stone-600">
                    {refund.payment?.method === 'eft'
                      ? 'Havale / EFT'
                      : refund.payment?.method === 'card'
                        ? 'Kredi kartı'
                        : 'Ödeme kaydı doğrulanmalı'}
                    {' · '}
                    {manual
                      ? 'Manuel işlem gerekli'
                      : refund.status === 'partially_completed'
                        ? 'Kısmen tamamlandı · Hata var'
                        : 'Başarısız'}
                  </p>
                  <p className="mt-1 break-all text-xs text-stone-600">İade işlemi: {refund.id}</p>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                    <time dateTime={refund.createdAt.toISOString()} className="text-stone-600">
                      {refund.createdAt.toLocaleString('tr-TR', {
                        timeZone: 'Europe/Istanbul',
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </time>
                    <span className="inline-flex items-center gap-1 font-medium text-[var(--color-primary)]">
                      Siparişi aç <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
      {queue.total > 0 && (
        <p className="mt-2 text-xs text-stone-600">
          {queue.total > queue.rows.length
            ? `En eski ${queue.rows.length} işlem gösteriliyor; toplam ${queue.total} işlem var.`
            : 'En eski işlem önce gösterilir.'}{' '}
          Her satır ayrı bir iade işlemidir; aynı sipariş birden fazla kez görünebilir.
        </p>
      )}
      <Link
        href={manual ? '/iadeler?tab=manual_refunds' : '/iadeler?tab=failed_card_refunds'}
        prefetch={false}
        className="mt-3 inline-block text-sm font-medium text-[var(--color-primary)] underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        Tümünü gör<span className="sr-only"> — {title}</span> →
      </Link>
    </section>
  )
}
