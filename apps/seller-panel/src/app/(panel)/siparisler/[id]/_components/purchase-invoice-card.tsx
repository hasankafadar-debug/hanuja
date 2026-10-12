import { Receipt } from 'lucide-react'
import {
  formatPurchaseInvoiceAmount,
  formatPurchaseInvoiceRate,
  type SellerPurchaseInvoice,
} from '@hanuja/api/domain/seller-purchase-invoice'

export interface PurchaseInvoiceStatus {
  reviewStatus: 'pending' | 'approved' | 'rejected' | null
  reviewNote: string | null
  invoiceNumber: string | null
  invoiceDate: string | null
  expectedPayoutDate: string | null
  shipped: boolean
}

// A zero deduction (no coupon, exempt commission) is shown without a minus sign.
function formatDeduction(amount: SellerPurchaseInvoice['grossAmount']) {
  const formatted = formatPurchaseInvoiceAmount(amount)
  return amount.isZero() ? formatted : `−${formatted}`
}

function formatDay(value: string) {
  return new Date(value).toLocaleDateString('tr-TR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/Istanbul',
  })
}

function StatusNote({ status }: { status: PurchaseInvoiceStatus }) {
  const base = 'rounded-lg border px-4 py-3 text-sm'
  if (status.reviewStatus === 'approved') {
    return (
      <div className={base} style={{ borderColor: 'var(--color-success)', color: 'var(--color-primary)' }}>
        <p className="font-medium">Faturanız onaylandı.</p>
        <p className="mt-1" style={{ color: 'var(--color-muted-fg)' }}>
          {status.invoiceNumber ? `Fatura No: ${status.invoiceNumber}` : null}
          {status.invoiceDate ? ` · Fatura tarihi: ${formatDay(status.invoiceDate)}` : null}
        </p>
        {status.expectedPayoutDate ? (
          <p className="mt-1" style={{ color: 'var(--color-muted-fg)' }}>
            Beklenen ödeme tarihi: <strong>{formatDay(status.expectedPayoutDate)}</strong> (teslim onayı ve
            açık iade durumuna bağlıdır)
          </p>
        ) : null}
      </div>
    )
  }
  if (status.reviewStatus === 'rejected') {
    return (
      <div role="alert" className={base} style={{ borderColor: 'var(--color-destructive)', color: 'var(--color-primary)' }}>
        <p className="font-medium">Faturanız onaylanmadı.</p>
        {status.reviewNote ? (
          <p className="mt-1" style={{ color: 'var(--color-muted-fg)' }}>
            Gerekçe: {status.reviewNote}
          </p>
        ) : null}
        <p className="mt-1" style={{ color: 'var(--color-muted-fg)' }}>
          Faturayı düzeltip aşağıdan yeniden yükleyin.
        </p>
      </div>
    )
  }
  if (status.reviewStatus === 'pending') {
    return (
      <p className={base} style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted-fg)' }}>
        Faturanız alındı, Hanuja kontrol ediyor. Hakediş vadesi onaylanan fatura tarihinden hesaplanır.
      </p>
    )
  }
  return status.shipped ? (
    <p role="alert" className={base} style={{ borderColor: 'var(--color-warning)', color: 'var(--color-primary)' }}>
      Fatura bekleniyor. Ürünü kargoya verdiniz; faturanızı kesip aşağıdan yükleyin veya fatura e-posta adresine
      gönderin. Fatura gelmeden hakediş süresi başlamaz.
    </p>
  ) : (
    <p className={base} style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted-fg)' }}>
      Faturayı ürünü kargoya verirken kesin ve yükleyin.
    </p>
  )
}

/** Satıcının Hanuja'ya keseceği faturanın dökümü (satıcı Hanuja modeli); hesap sunucudadır. */
export default function PurchaseInvoiceCard({
  orderNumber,
  invoice,
  status,
}: {
  orderNumber: string
  invoice: SellerPurchaseInvoice
  status: PurchaseInvoiceStatus
}) {
  const hasCoupon = invoice.couponShareAmount.gt(0)
  return (
    <section
      className="rounded-xl border p-5"
      style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
    >
      <div className="mb-4 flex items-center gap-2">
        <Receipt className="h-4 w-4" aria-hidden="true" style={{ color: 'var(--color-accent)' }} />
        <h2 className="text-base font-semibold" style={{ color: 'var(--color-primary)' }}>
          Hanuja&apos;ya Keseceğiniz Fatura
        </h2>
      </div>

      <div
        className="mb-4 rounded-lg px-4 py-3 text-sm"
        style={{ backgroundColor: 'var(--color-muted)', color: 'var(--color-primary)' }}
      >
        Faturayı ürünü kargoya verirken kesin. Faturanın açıklama alanına sipariş numarasını yazın:{' '}
        <strong>{orderNumber}</strong>
      </div>

      {invoice.lines.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>
          Bu siparişte faturalanacak aktif ürün kalmadı.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr style={{ color: 'var(--color-muted-fg)' }}>
                <th className="py-2 pr-3 text-left font-medium">Ürün</th>
                <th className="py-2 pr-3 text-right font-medium">Adet</th>
                <th className="py-2 pr-3 text-right font-medium">Satış (KDV dahil)</th>
                {hasCoupon ? <th className="py-2 pr-3 text-right font-medium">Kampanya payı</th> : null}
                <th className="py-2 pr-3 text-right font-medium">Komisyon (KDV dahil)</th>
                <th className="py-2 text-right font-medium">Fatura tutarı (KDV dahil)</th>
              </tr>
            </thead>
            <tbody>
              {invoice.lines.map((line) => (
                <tr key={line.orderLineId} className="border-t" style={{ borderColor: 'var(--color-border)' }}>
                  <td className="py-2 pr-3" style={{ color: 'var(--color-primary)' }}>
                    {line.productName}
                    {line.variantName ? (
                      <span style={{ color: 'var(--color-muted-fg)' }}> · {line.variantName}</span>
                    ) : null}
                  </td>
                  <td className="py-2 pr-3 text-right">{line.quantity}</td>
                  <td className="py-2 pr-3 text-right">{formatPurchaseInvoiceAmount(line.grossAmount)}</td>
                  {hasCoupon ? (
                    <td className="py-2 pr-3 text-right">{formatDeduction(line.couponShareAmount)}</td>
                  ) : null}
                  <td className="py-2 pr-3 text-right">
                    {formatDeduction(line.commissionAmount)}
                    {line.commissionAmount.isZero() ? null : (
                      <span className="block text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                        {formatPurchaseInvoiceRate(line.commissionRate)} + KDV
                      </span>
                    )}
                  </td>
                  <td className="py-2 text-right font-medium" style={{ color: 'var(--color-primary)' }}>
                    {formatPurchaseInvoiceAmount(line.invoiceAmount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {invoice.lines.length > 0 ? (
        <div className="mt-4 space-y-1 border-t pt-4 text-sm" style={{ borderColor: 'var(--color-border)' }}>
          <p className="flex justify-between gap-4 pt-1 text-base font-semibold" style={{ color: 'var(--color-primary)' }}>
            <span>Fatura toplamı (KDV dahil)</span>
            <span>{formatPurchaseInvoiceAmount(invoice.invoiceAmount)}</span>
          </p>
        </div>
      ) : null}

      <div className="mt-4">
        <StatusNote status={status} />
      </div>
    </section>
  )
}
