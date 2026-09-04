import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'
import type { AdminRefundQueueRow } from '@hanuja/api/services/admin-refund-query.service'
import { formatOrderDisplayNumber } from '@hanuja/api/lib/order-number'
import { refundQueueHref, type RefundQueueParams } from '../../../../lib/admin-refund-list-params'
import {
  CARD_REFUND_RETRY_WARNING,
  formatRefundOutstandingAmount,
  refundPaymentLabel,
  refundSourceLabels,
} from '../../../../lib/admin-refund-presentation'

type Props = {
  params: RefundQueueParams
  result: { rows: AdminRefundQueueRow[]; total: number }
}

export function RefundPaymentQueue({ params, result }: Props) {
  const manual = params.tab === 'manual_refunds'
  const title = manual ? 'Manuel ödeme iadeleri' : 'Başarısız kart iadeleri'
  const filtered = Boolean(params.q || params.method !== 'all' || params.source !== 'all')
  const totalPages = Math.max(1, Math.ceil(result.total / params.pageSize))
  const first = result.total > 0 ? (params.page - 1) * params.pageSize + 1 : 0
  const last = result.total > 0 ? first + result.rows.length - 1 : 0
  const resetHref = refundQueueHref({ ...params, q: '', method: 'all', source: 'all' }, 1)
  const controlClass =
    'h-10 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2'
  const linkClass =
    'inline-flex min-h-10 items-center rounded-md border border-[var(--color-border)] px-3 py-2 text-sm font-medium hover:bg-[var(--color-muted)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2'

  return (
    <section
      aria-labelledby="refund-queue-title"
      className="min-w-0 space-y-4"
      data-testid="refund-payment-queue"
    >
      <div>
        <h2 id="refund-queue-title" className="font-semibold text-[var(--color-primary)]">
          {title}
        </h2>
        <p className="mt-1 text-sm text-stone-600">
          {manual
            ? 'Havale / EFT iadeleri ve manuel mutabakat gerektiren diğer iadeler.'
            : 'Tamamlanmamış, hata içeren kart iadeleri.'}{' '}
          Her satır ayrı bir iade işlemidir; aynı sipariş birden fazla kez görünebilir.
        </p>
      </div>

      {!manual && result.total > 0 && (
        <div className="flex gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>{CARD_REFUND_RETRY_WARNING}</p>
        </div>
      )}

      <form
        action="/iadeler"
        method="GET"
        className="flex flex-wrap items-end gap-3"
        aria-label="Ödeme iadesi filtreleri"
      >
        <input type="hidden" name="tab" value={params.tab} />
        <label className="min-w-0 flex-1 basis-64 text-sm text-stone-600">
          Sipariş / müşteri / iade işlemi
          <input
            type="search"
            name="q"
            defaultValue={params.q}
            maxLength={100}
            placeholder="Sipariş no, müşteri adı veya işlem kimliği"
            className={`mt-1 ${controlClass}`}
          />
        </label>
        {manual && (
          <label className="text-sm text-stone-600">
            Ödeme yöntemi
            <select name="method" defaultValue={params.method} className={`mt-1 ${controlClass}`}>
              <option value="all">Tüm yöntemler</option>
              <option value="eft">Havale / EFT</option>
              <option value="card">Kredi kartı</option>
              <option value="missing">Ödeme kaydı eksik</option>
            </select>
          </label>
        )}
        <label className="text-sm text-stone-600">
          İade kaynağı
          <select name="source" defaultValue={params.source} className={`mt-1 ${controlClass}`}>
            <option value="all">Tüm kaynaklar</option>
            <option value="cancellation">İptal</option>
            <option value="return_request">Ürün iadesi</option>
            <option value="dispute">Uyuşmazlık</option>
          </select>
        </label>
        <label className="text-sm text-stone-600">
          Sayfa boyutu
          <select name="pageSize" defaultValue={params.pageSize} className={`mt-1 ${controlClass}`}>
            {[20, 50, 100].map((size) => (
              <option key={size} value={size}>
                {size} / sayfa
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className={`${linkClass} bg-[var(--color-muted)]`}>
          Filtrele
        </button>
        {filtered && (
          <Link href={resetHref} prefetch={false} className={linkClass}>
            Filtreleri temizle
          </Link>
        )}
      </form>

      <div className="flex flex-wrap justify-between gap-2 text-sm text-stone-600">
        <p>
          {result.total} {filtered ? 'eşleşen ' : ''}iade işlemi · En eski işlem önce
        </p>
        <p>Kalan tutarlar gösterilir; bu liste ödeme yapmaz.</p>
      </div>

      {result.rows.length === 0 ? (
        <div
          className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-8 text-center text-sm text-stone-600"
          data-testid="refund-queue-empty"
        >
          {filtered
            ? 'Filtrelere uygun iade işlemi bulunamadı. Filtreleri temizleyerek tüm kuyruğu görebilirsiniz.'
            : manual
              ? 'Manuel ödeme iadesi bekleyen işlem yok.'
              : 'Başarısız kart iadesi yok.'}
        </div>
      ) : (
        <div>
          <p className="mb-2 text-xs text-stone-600 md:hidden">
            Tüm sütunları görmek için tabloyu yana kaydırabilirsiniz.
          </p>
          <div
            role="region"
            aria-label={`${title} tablosu`}
            tabIndex={0}
            className="relative overflow-x-auto rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            <table className="w-full text-sm">
              <caption className="sr-only">{title} — her satır ayrı bir ödeme iadesidir</caption>
              <thead className="bg-[var(--color-muted)] text-left text-xs text-stone-600">
                <tr>
                  {[
                    'İade işlemi',
                    'Sipariş / Müşteri',
                    'Ödeme / Kaynak',
                    'Kalan iade',
                    'Durum',
                    'Oluşturulma',
                    'İşlem',
                  ].map((label) => (
                    <th
                      key={label}
                      scope="col"
                      className="whitespace-nowrap px-4 py-3 font-semibold"
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((refund) => (
                  <tr
                    key={refund.id}
                    data-testid={`refund-queue-row-${refund.id}`}
                    className="border-t border-[var(--color-border)] align-top hover:bg-[var(--color-muted)]"
                  >
                    <td className="min-w-[170px] px-4 py-4">
                      <span className="block max-w-[200px] break-all font-mono text-xs text-stone-600">
                        {refund.id}
                      </span>
                    </td>
                    <td className="min-w-[170px] px-4 py-4">
                      <Link
                        href={`/siparisler/${refund.orderId}`}
                        prefetch={false}
                        className="font-medium text-[var(--color-primary)] underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2"
                      >
                        {formatOrderDisplayNumber(refund.order.publicNumber, refund.orderId)}
                      </Link>
                      <p className="mt-1 max-w-[220px] break-words text-stone-600">
                        {refund.order.customer.name}
                      </p>
                    </td>
                    <td className="min-w-[150px] px-4 py-4 text-stone-600">
                      {refundPaymentLabel(refund.payment)}
                      <p className="mt-1 text-xs">{refundSourceLabels[refund.sourceType]}</p>
                    </td>
                    <td className="whitespace-nowrap px-4 py-4 text-right font-semibold tabular-nums text-[var(--color-primary)]">
                      {formatRefundOutstandingAmount(
                        refund.outstandingAmount,
                        refund.order.currency,
                      )}
                    </td>
                    <td className="min-w-[180px] px-4 py-4 text-stone-600">
                      {manual
                        ? 'Manuel işlem gerekli'
                        : refund.status === 'partially_completed'
                          ? 'Kısmen tamamlandı · Hata var'
                          : 'Başarısız'}
                    </td>
                    <td className="whitespace-nowrap px-4 py-4 text-stone-600">
                      <time dateTime={refund.createdAt.toISOString()}>
                        {refund.createdAt.toLocaleString('tr-TR', {
                          timeZone: 'Europe/Istanbul',
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </time>
                    </td>
                    <td className="whitespace-nowrap px-4 py-4">
                      <Link
                        href={`/siparisler/${refund.orderId}`}
                        prefetch={false}
                        className="font-medium text-[var(--color-primary)] underline underline-offset-2 focus-visible:outline focus-visible:outline-2"
                      >
                        Siparişi aç
                        <span className="sr-only">
                          {' '}
                          — {formatOrderDisplayNumber(
                            refund.order.publicNumber,
                            refund.orderId,
                          )} · {refund.id}
                        </span>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <nav
        aria-label="Ödeme iadesi sayfaları"
        className="flex flex-wrap items-center justify-between gap-3 text-sm"
      >
        <p className="text-stone-600">
          {first}–{last} / {result.total} işlem · Sayfa {params.page} / {totalPages}
        </p>
        <div className="flex gap-2">
          {params.page > 1 ? (
            <Link
              href={refundQueueHref(params, params.page - 1)}
              prefetch={false}
              className={linkClass}
              rel="prev"
            >
              Önceki
            </Link>
          ) : (
            <span aria-disabled="true" className={`${linkClass} opacity-50`}>
              Önceki
            </span>
          )}
          {params.page < totalPages ? (
            <Link
              href={refundQueueHref(params, params.page + 1)}
              prefetch={false}
              className={linkClass}
              rel="next"
            >
              Sonraki
            </Link>
          ) : (
            <span aria-disabled="true" className={`${linkClass} opacity-50`}>
              Sonraki
            </span>
          )}
        </div>
      </nav>
    </section>
  )
}
