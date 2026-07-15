import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { PageHeader, StatusBadge } from '@hanuja/ui'
import { getSellerFromSession } from '@/lib/seller-session'
import { createPayoutRepository } from '@hanuja/api/repositories/payout.repository'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { formatOrderDisplayNumber } from '@hanuja/api/lib/order-number'
import { formatMoney, maskIban } from '@hanuja/security'
import { holdDaysRemainingLabel, formatTrDate, payoutStatusDisplay } from '../_lib/payout-display'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Hakediş Detayı' }

interface Props {
  params: Promise<{ id: string }>
}

function toNum(value: unknown): number {
  if (value === null || value === undefined) return 0
  if (typeof value === 'object' && 'toNumber' in (value as object)) {
    return (value as { toNumber(): number }).toNumber()
  }
  return Number(value)
}

const surfaceCard =
  'rounded-xl border p-5'
const cardStyle = { borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' } as const

export default async function PayoutDetailPage({ params }: Props) {
  const { id } = await params
  const { seller } = await getSellerFromSession({ allowSuspended: true })

  const payoutRepo = createPayoutRepository(createPrismaForRoute())
  const payout = await payoutRepo.findByIdForSeller(id, seller.id)
  if (!payout) notFound()

  const order = payout.order
  const lines = order?.lines ?? []
  const statusDisplay = payoutStatusDisplay(payout.status)
  const orderNumber = formatOrderDisplayNumber(order?.publicNumber ?? null, payout.orderId)

  const gross = toNum(payout.grossAmount)
  const couponShare = toNum(payout.couponShareAmount)
  const commission = toNum(payout.commissionAmount)
  const cargoCharge = toNum(payout.cargoChargeAmount)
  const penalty = toNum(payout.penaltyAmount)
  const refund = toNum(payout.refundAmount)
  const adjustment = toNum(payout.adjustmentAmount)
  const net = toNum(payout.netAmount)

  const isPaid = payout.status === 'payout_paid'
  const isBlocked = payout.status === 'payout_blocked'
  const holdRemaining = holdDaysRemainingLabel(payout.holdUntil)

  return (
    <div className="max-w-4xl space-y-6" data-testid="seller-payout-detail-page">
      <div>
        <Link
          href="/odemeler"
          className="mb-4 inline-flex items-center gap-1.5 text-sm"
          style={{ color: 'var(--color-muted-fg)' }}
        >
          <ArrowLeft className="h-4 w-4" />
          Hakedişlere Dön
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <PageHeader title="Hakediş Detayı" description={`Sipariş ${orderNumber}`} />
          <StatusBadge
            status={statusDisplay.badgeStatus as Parameters<typeof StatusBadge>[0]['status']}
            label={statusDisplay.label}
          />
        </div>
      </div>

      {/* ── Satır tablosu ─────────────────────────────────────── */}
      <section className={surfaceCard} style={cardStyle}>
        <h2 className="mb-4 font-semibold" style={{ color: 'var(--color-primary)' }}>
          Sipariş Satırları
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full whitespace-nowrap text-sm">
            <thead style={{ backgroundColor: 'var(--color-muted)' }}>
              <tr>
                {['Ürün', 'Adet', 'Birim Fiyat', 'Satır Toplamı', 'Kupon İndirimi', 'Komisyon', 'Net Hakediş'].map(
                  (header) => (
                    <th
                      key={header}
                      className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide"
                      style={{ color: 'var(--color-muted-fg)' }}
                    >
                      {header}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => {
                const lineCoupon = toNum(line.couponDiscountAmount)
                const lineCommission = toNum(line.commissionAmount)
                const ratePercent = toNum(line.commissionRate) * 100
                const isExempt = Boolean(line.commissionExemptedAt)
                return (
                  <tr key={line.id} className="border-t" style={{ borderColor: 'var(--color-border)' }}>
                    <td className="px-3 py-2" style={{ color: 'var(--color-primary)' }}>
                      {line.productName}
                      {line.variantName ? (
                        <span style={{ color: 'var(--color-muted-fg)' }}> ({line.variantName})</span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2" style={{ color: 'var(--color-muted-fg)' }}>
                      {line.quantity}
                    </td>
                    <td className="px-3 py-2" style={{ color: 'var(--color-muted-fg)' }}>
                      {formatMoney(toNum(line.unitPrice))}
                    </td>
                    <td className="px-3 py-2" style={{ color: 'var(--color-muted-fg)' }}>
                      {formatMoney(toNum(line.totalPrice))}
                    </td>
                    <td className="px-3 py-2" style={{ color: 'var(--color-muted-fg)' }}>
                      {lineCoupon > 0 ? `-${formatMoney(lineCoupon)}` : '-'}
                    </td>
                    <td className="px-3 py-2" style={{ color: 'var(--color-muted-fg)' }}>
                      {isExempt ? (
                        <span style={{ color: 'var(--color-primary)' }}>Muaf</span>
                      ) : (
                        <>
                          %{ratePercent.toLocaleString('tr-TR', { maximumFractionDigits: 2 })}
                          {' · '}
                          {lineCommission > 0 ? `-${formatMoney(lineCommission)}` : formatMoney(0)}
                        </>
                      )}
                    </td>
                    <td className="px-3 py-2 font-medium" style={{ color: 'var(--color-primary)' }}>
                      {formatMoney(toNum(line.netPayoutAmount))}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Hesap dökümü ─────────────────────────────────────── */}
      <section className={surfaceCard} style={cardStyle}>
        <h2 className="mb-4 font-semibold" style={{ color: 'var(--color-primary)' }}>
          Hesap Dökümü
        </h2>
        <dl className="space-y-2 text-sm">
          <BreakdownRow label="Brüt tutar" value={formatMoney(gross)} />
          {couponShare > 0 ? (
            <BreakdownRow label="Kupon payı" value={`-${formatMoney(couponShare)}`} />
          ) : null}
          <BreakdownRow label="Komisyon (KDV dahil)" value={`-${formatMoney(commission)}`} />
          {cargoCharge > 0 ? <BreakdownRow label="Kargo kesintisi" value={`-${formatMoney(cargoCharge)}`} /> : null}
          {penalty > 0 ? (
            <BreakdownRow label="Ceza kesintisi" value={`-${formatMoney(penalty)}`} destructive />
          ) : null}
          {refund > 0 ? <BreakdownRow label="İade kesintisi" value={`-${formatMoney(refund)}`} /> : null}
          {adjustment !== 0 ? (
            <BreakdownRow
              label="Düzeltme"
              value={`${adjustment < 0 ? '-' : '+'}${formatMoney(Math.abs(adjustment))}`}
            />
          ) : null}
          <div
            className="mt-3 flex items-center justify-between border-t pt-3 text-base font-semibold"
            style={{ borderColor: 'var(--color-border)' }}
          >
            <dt style={{ color: 'var(--color-primary)' }}>Net Hakediş</dt>
            <dd style={{ color: net < 0 ? 'var(--color-destructive)' : 'var(--color-primary)' }}>
              {formatMoney(net)}
            </dd>
          </div>
        </dl>
      </section>

      {/* ── Zaman çizelgesi ──────────────────────────────────── */}
      <section className={surfaceCard} style={cardStyle}>
        <h2 className="mb-4 font-semibold" style={{ color: 'var(--color-primary)' }}>
          Zaman Çizelgesi
        </h2>
        <dl className="space-y-2 text-sm">
          <BreakdownRow label="Teslimat onayı" value={formatTrDate(payout.holdStartedAt)} />
          <BreakdownRow
            label="Bloke bitiş"
            value={
              payout.holdUntil
                ? `${formatTrDate(payout.holdUntil)} (${holdRemaining === 'Doldu' ? 'Doldu' : `${holdRemaining} gün`})`
                : '-'
            }
          />
          <div className="flex items-center justify-between">
            <dt style={{ color: 'var(--color-muted-fg)' }}>Durum</dt>
            <dd>
              <StatusBadge
                status={statusDisplay.badgeStatus as Parameters<typeof StatusBadge>[0]['status']}
                label={statusDisplay.label}
              />
            </dd>
          </div>
        </dl>
        {isBlocked ? (
          <div
            className="mt-4 rounded-lg border p-3 text-sm"
            style={{
              borderColor: 'var(--color-destructive)',
              color: 'var(--color-destructive)',
              backgroundColor: 'var(--color-muted)',
            }}
          >
            <strong>Ödeme bloke:</strong>{' '}
            {payout.blockedReason ?? 'Bloke nedeni belirtilmemiş. Destek ile iletişime geçin.'}
          </div>
        ) : null}
      </section>

      {/* ── Ödeme bilgisi (ödendiyse) ────────────────────────── */}
      {isPaid ? (
        <section className={surfaceCard} style={cardStyle}>
          <h2 className="mb-4 font-semibold" style={{ color: 'var(--color-primary)' }}>
            Ödeme Bilgisi
          </h2>
          <dl className="space-y-2 text-sm">
            <BreakdownRow label="Transfer tarihi" value={formatTrDate(payout.transferDate)} />
            {payout.transferBankName ? <BreakdownRow label="Banka" value={payout.transferBankName} /> : null}
            {payout.transferReference ? (
              <BreakdownRow label="Referans" value={payout.transferReference} />
            ) : null}
            {payout.ibanSnapshot ? <BreakdownRow label="IBAN" value={maskIban(payout.ibanSnapshot)} /> : null}
            {payout.transferNote ? <BreakdownRow label="Not" value={payout.transferNote} /> : null}
          </dl>
        </section>
      ) : null}

      <div
        className="rounded-xl p-4 text-sm"
        style={{ backgroundColor: 'var(--color-muted)', color: 'var(--color-muted-fg)' }}
      >
        <strong style={{ color: 'var(--color-primary)' }}>Bilgi:</strong>{' '}
        Teslimat onayından itibaren 30 gün sonra ödeme yapılır. Açık iade veya uyuşmazlık ödemeyi bloke
        edebilir.
      </div>
    </div>
  )
}

function BreakdownRow({
  label,
  value,
  destructive,
}: {
  label: string
  value: string
  destructive?: boolean
}) {
  return (
    <div className="flex items-center justify-between">
      <dt style={{ color: 'var(--color-muted-fg)' }}>{label}</dt>
      <dd style={{ color: destructive ? 'var(--color-destructive)' : 'var(--color-primary)' }}>{value}</dd>
    </div>
  )
}
