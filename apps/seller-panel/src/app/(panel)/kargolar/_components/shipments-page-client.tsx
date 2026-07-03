'use client'

import { useState } from 'react'
import Link from 'next/link'
import { StatusBadge, PageHeader, EmptyState, Spinner, Button } from '@hanuja/ui'
import { Truck, Package, Plus, AlertTriangle } from 'lucide-react'
import { formatOrderDisplayNumber } from '@hanuja/api/lib/order-number'

export interface ShipmentListItem {
  id: string
  orderId: string
  cargoProvider: string
  trackingNumber: string | null
  status: string
  handedAt: string | null
  deliveredAt: string | null
  createdAt: string
  order: {
    id: string
    publicNumber: number | null
    status: string
    totalAmount: string
  }
  events: Array<{
    status: string
    description: string | null
    occurredAt: string
  }>
}

interface TrackingModalState {
  open: boolean
  orderId: string
  shipmentId: string | null
}

interface Props {
  initialShipments: ShipmentListItem[]
}

const cargoProviders = ['yurtiçi', 'aras', 'ptt', 'mng', 'sürat', 'ups', 'fedex', 'dhl']

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('tr-TR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

export default function ShipmentsPageClient({ initialShipments }: Props) {
  const [shipments, setShipments] = useState(initialShipments)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [trackingModal, setTrackingModal] = useState<TrackingModalState>({
    open: false,
    orderId: '',
    shipmentId: null,
  })
  const [trackingForm, setTrackingForm] = useState({
    trackingNumber: '',
    cargoProvider: 'yurtiçi',
  })
  const [submitting, setSubmitting] = useState(false)

  async function refreshShipments() {
    setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/seller/shipments')
      if (!res.ok) throw new Error('Kargo listesi yuklenemedi')
      const { data } = (await res.json()) as { data?: ShipmentListItem[] }
      setShipments(data ?? [])
    } catch {
      setError('Kargo listesi yuklenirken hata olustu')
    } finally {
      setLoading(false)
    }
  }

  async function enterTracking() {
    if (!trackingForm.trackingNumber.trim()) {
      setError('Takip numarasi zorunludur')
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch('/api/seller/shipments/tracking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: trackingModal.orderId,
          trackingNumber: trackingForm.trackingNumber.trim(),
          cargoProvider: trackingForm.cargoProvider,
        }),
      })

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string }
        setError(body.message ?? 'Takip numarasi kaydedilemedi')
        return
      }

      setTrackingModal({ open: false, orderId: '', shipmentId: null })
      setTrackingForm({ trackingNumber: '', cargoProvider: 'yurtiçi' })
      await refreshShipments()
    } catch {
      setError('Takip numarasi kaydedilemedi')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-6" data-testid="seller-shipments-page">
      <PageHeader
        title="Kargolar"
        description={
          loading ? `${shipments.length} kargo kaydi · Guncelleniyor...` : `${shipments.length} kargo kaydi`
        }
      />

      {error ? (
        <div
          className="flex items-center gap-2 rounded-lg border px-4 py-3 text-sm"
          style={{ borderColor: 'var(--color-danger)', color: 'var(--color-danger)' }}
        >
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
          <button className="ml-auto" onClick={() => setError(null)} type="button">
            x
          </button>
        </div>
      ) : null}

      {shipments.length === 0 ? (
        <EmptyState
          icon={<Truck className="h-12 w-12" />}
          title="Henuz kargo kaydi yok"
          description="Siparislerinizi hazirladikca kargo bilgileri burada gorunecek."
          action={
            <Link href="/siparisler">
              <Button variant="outline">Siparislere Git</Button>
            </Link>
          }
        />
      ) : (
        <div
          className="rounded-xl border overflow-x-auto"
          style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
        >
          <table className="w-full text-sm">
            <thead style={{ backgroundColor: 'var(--color-muted)' }}>
              <tr>
                {['Siparis', 'Kargo Firmasi', 'Takip No', 'Son Durum', 'Tarih', 'Islem'].map((heading) => (
                  <th
                    key={heading}
                    className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide"
                    style={{ color: 'var(--color-muted-fg)' }}
                  >
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shipments.map((shipment) => (
                <tr
                  key={shipment.id}
                  className="border-t"
                  style={{ borderColor: 'var(--color-border)' }}
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/siparisler/${shipment.orderId}`}
                      className="font-medium hover:underline"
                      style={{ color: 'var(--color-primary)' }}
                    >
                      {formatOrderDisplayNumber(shipment.order.publicNumber, shipment.orderId)}
                    </Link>
                    <div className="text-xs mt-0.5" style={{ color: 'var(--color-muted-fg)' }}>
                      {Number(shipment.order.totalAmount).toLocaleString('tr-TR', {
                        maximumFractionDigits: 0,
                      })}{' '}
                      TL
                    </div>
                  </td>
                  <td className="px-4 py-3" style={{ color: 'var(--color-muted-fg)' }}>
                    {shipment.cargoProvider}
                  </td>
                  <td className="px-4 py-3">
                    {shipment.trackingNumber ? (
                      <span
                        className="font-mono text-xs"
                        style={{ color: 'var(--color-primary)' }}
                      >
                        {shipment.trackingNumber}
                      </span>
                    ) : (
                      <span className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                        Girilmedi
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={shipment.status} />
                  </td>
                  <td className="px-4 py-3 text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                    {formatDate(shipment.createdAt)}
                  </td>
                  <td className="px-4 py-3">
                    {!shipment.trackingNumber ? (
                      <button
                        onClick={() =>
                          setTrackingModal({
                            open: true,
                            orderId: shipment.orderId,
                            shipmentId: shipment.id,
                          })
                        }
                        className="flex items-center gap-1 text-xs rounded-lg border px-2.5 py-1.5 transition-colors hover:bg-[var(--color-muted)]"
                        style={{
                          borderColor: 'var(--color-border)',
                          color: 'var(--color-primary)',
                        }}
                        type="button"
                      >
                        <Plus className="h-3 w-3" />
                        Takip gir
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--color-muted-fg)' }}>
          <Spinner size="sm" />
          Liste guncelleniyor...
        </div>
      ) : null}

      {trackingModal.open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0"
            style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
            onClick={() => setTrackingModal({ open: false, orderId: '', shipmentId: null })}
          />
          <div
            className="relative z-10 w-full max-w-md rounded-xl border p-6 shadow-xl"
            style={{
              borderColor: 'var(--color-border)',
              backgroundColor: 'var(--color-surface)',
            }}
          >
            <div className="flex items-center gap-2 mb-4">
              <Package className="h-5 w-5" style={{ color: 'var(--color-accent)' }} />
              <h3 className="font-semibold" style={{ color: 'var(--color-primary)' }}>
                Kargo Takip Numarasi
              </h3>
            </div>

            <div className="space-y-4">
              <div>
                <label
                  htmlFor="shipment-cargo-provider"
                  className="mb-1 block text-xs"
                  style={{ color: 'var(--color-muted-fg)' }}
                >
                  Kargo Firmasi
                </label>
                <select
                  id="shipment-cargo-provider"
                  aria-label="Kargo firmasi"
                  value={trackingForm.cargoProvider}
                  onChange={(event) =>
                    setTrackingForm((current) => ({
                      ...current,
                      cargoProvider: event.target.value,
                    }))
                  }
                  className="w-full rounded-lg border px-3 py-2 text-sm"
                  style={{
                    borderColor: 'var(--color-border)',
                    backgroundColor: 'var(--color-bg)',
                    color: 'var(--color-primary)',
                  }}
                >
                  {cargoProviders.map((provider) => (
                    <option key={provider} value={provider}>
                      {provider.charAt(0).toUpperCase() + provider.slice(1)} Kargo
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="shipment-tracking-number"
                  className="mb-1 block text-xs"
                  style={{ color: 'var(--color-muted-fg)' }}
                >
                  Takip Numarasi *
                </label>
                <input
                  id="shipment-tracking-number"
                  type="text"
                  placeholder="Orn: YK20261234567"
                  value={trackingForm.trackingNumber}
                  onChange={(event) =>
                    setTrackingForm((current) => ({
                      ...current,
                      trackingNumber: event.target.value,
                    }))
                  }
                  className="w-full rounded-lg border px-3 py-2 text-sm font-mono"
                  style={{
                    borderColor: 'var(--color-border)',
                    backgroundColor: 'var(--color-bg)',
                    color: 'var(--color-primary)',
                  }}
                />
              </div>

              <div
                className="rounded-lg p-3 text-xs"
                style={{
                  backgroundColor: 'var(--color-muted)',
                  color: 'var(--color-muted-fg)',
                }}
              >
                <strong>Not:</strong> Takip numarasini girdikten sonra siparis "Kargoya verildi"
                durumuna gececek ve musteri bilgilendirilecek.
              </div>
            </div>

            <div className="mt-5 flex gap-3">
              <Button onClick={enterTracking} disabled={submitting} className="flex-1" type="button">
                {submitting ? 'Kaydediliyor...' : 'Kaydet ve Kargoya Ver'}
              </Button>
              <Button
                variant="ghost"
                onClick={() => setTrackingModal({ open: false, orderId: '', shipmentId: null })}
                disabled={submitting}
                type="button"
              >
                Iptal
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
