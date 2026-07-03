import { XCircle } from 'lucide-react'
import { formatMoney } from '@hanuja/security'

const CANCELLATION_REASON_LABELS: Record<string, string> = {
  customer_requested: 'Müşteri isteğiyle iptal',
  admin_cancelled: 'Yönetici kararıyla iptal',
  payment_failed: 'Ödeme başarısızlığı',
  seller_rejected: 'Satıcı reddi',
  auto_canceled_20day_breach: '20 iş günü ihlali — otomatik iptal',
  other: 'Diğer',
}

const SELLER_REJECTION_REASON_LABELS: Record<string, string> = {
  stock_error: 'Stok hatası',
  pricing_error: 'Fiyatlandırma hatası',
  production_impossibility: 'Üretim imkânsızlığı',
  quality_issue: 'Kalite sorunu',
  technical_issue: 'Teknik sorun',
  force_majeure: 'Mücbir sebep',
  other: 'Diğer',
}

type HistoryEvent = {
  id: string
  fromStatus: string | null
  toStatus: string
  reason: string | null
  note: string | null
  createdAt: Date
}

type Penalty = {
  id: string
  reason: string
  status: string
  penaltyAmount: { toNumber(): number } | number
  createdAt: Date
}

interface Props {
  cancellationReason: string | null
  cancelledAt: Date | null
  orderStatus: string
  statusHistory: HistoryEvent[]
  penalties: Penalty[]
}

function moneyToNumber(value: { toNumber(): number } | number) {
  return typeof value === 'object' ? value.toNumber() : Number(value)
}

export function CancellationDetailCard({
  cancellationReason,
  cancelledAt,
  orderStatus,
  statusHistory,
  penalties,
}: Props) {
  const isCancelled = orderStatus.startsWith('cancelled_')
  if (!isCancelled) return null

  const reasonLabel = cancellationReason
    ? (CANCELLATION_REASON_LABELS[cancellationReason] ?? cancellationReason)
    : '—'

  // Satıcı reddi geçişini bul: seller_rejected → cancelled_due_to_seller_rejection
  const rejectionEvent = statusHistory.find(
    (e) =>
      e.toStatus === 'seller_rejected' ||
      e.toStatus === 'cancelled_due_to_seller_rejection',
  )

  // 20 gün ihlali: breach cezasını bul
  const breachPenalty = penalties.find(
    (p) => p.reason === 'fulfillment_20day_breach' || p.reason === 'late_shipment_daily_accrual',
  )
  const totalAccruedPenalty = penalties
    .filter(
      (p) =>
        p.reason === 'late_shipment_daily_accrual' || p.reason === 'fulfillment_20day_breach',
    )
    .reduce((sum, p) => sum + moneyToNumber(p.penaltyAmount), 0)

  const is20DayBreach = orderStatus === 'cancelled_due_to_20day_breach'
  const isSellerRejection = orderStatus === 'cancelled_due_to_seller_rejection'

  // Satıcı reddi nedenini statusHistory note'undan çöz
  let sellerRejectionLabel: string | null = null
  let sellerRejectionNote: string | null = null
  if (isSellerRejection && rejectionEvent?.reason) {
    const parts = rejectionEvent.reason.split(':')
    const reasonCode = parts[0]?.trim() ?? ''
    const freeText = parts.slice(1).join(':').trim()
    sellerRejectionLabel = SELLER_REJECTION_REASON_LABELS[reasonCode] ?? reasonCode
    sellerRejectionNote = freeText || rejectionEvent.note || null
  }

  return (
    <section
      className="rounded-xl border p-5"
      style={{ borderColor: '#fca5a5', backgroundColor: '#fff5f5' }}
    >
      <div className="mb-3 flex items-center gap-2">
        <XCircle className="h-4 w-4" style={{ color: 'var(--color-destructive)' }} />
        <h2 className="font-semibold" style={{ color: '#7f1d1d' }}>
          İptal Detayı
        </h2>
      </div>

      <div className="space-y-2 text-sm">
        <div className="flex justify-between gap-4">
          <span style={{ color: '#9b1c1c' }}>İptal nedeni</span>
          <span className="font-medium" style={{ color: '#7f1d1d' }}>
            {reasonLabel}
          </span>
        </div>

        {cancelledAt ? (
          <div className="flex justify-between gap-4">
            <span style={{ color: '#9b1c1c' }}>İptal tarihi</span>
            <span style={{ color: '#7f1d1d' }}>
              {new Date(cancelledAt).toLocaleString('tr-TR', {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          </div>
        ) : null}

        {isSellerRejection && sellerRejectionLabel ? (
          <>
            <div className="flex justify-between gap-4">
              <span style={{ color: '#9b1c1c' }}>Satıcı red sebebi</span>
              <span className="font-medium" style={{ color: '#7f1d1d' }}>
                {sellerRejectionLabel}
              </span>
            </div>
            {sellerRejectionNote ? (
              <div className="flex justify-between gap-4">
                <span style={{ color: '#9b1c1c' }}>Satıcı açıklaması</span>
                <span className="text-right" style={{ color: '#7f1d1d', maxWidth: '60%' }}>
                  {sellerRejectionNote}
                </span>
              </div>
            ) : null}
          </>
        ) : null}

        {is20DayBreach ? (
          <>
            {breachPenalty ? (
              <div className="flex justify-between gap-4">
                <span style={{ color: '#9b1c1c' }}>İlk ceza tarihi</span>
                <span style={{ color: '#7f1d1d' }}>
                  {new Date(breachPenalty.createdAt).toLocaleDateString('tr-TR', {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  })}
                </span>
              </div>
            ) : null}
            {totalAccruedPenalty > 0 ? (
              <div className="flex justify-between gap-4">
                <span style={{ color: '#9b1c1c' }}>Toplam birikmiş ceza</span>
                <span className="font-semibold" style={{ color: 'var(--color-destructive)' }}>
                  {formatMoney(totalAccruedPenalty)}
                </span>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </section>
  )
}
