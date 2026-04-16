'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { StatusBadge, PageHeader, EmptyState, Spinner, Button } from '@hanuja/ui'
import { Truck, Package, Plus, AlertTriangle } from 'lucide-react'

interface Shipment {
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
    status: string
    totalAmount: string
  }
  events: Array<{
    status: string
    description: string | null
    occurredAt: string
  }>
}

// Satıcı sipariş listesinde takip numarası girmek için modal state
interface TrackingModalState {
  open: boolean
  orderId: string
  shipmentId: string | null
}

export default function ShipmentsPage() {
  const [shipments, setShipments] = useState<Shipment[]>([])
  const [loading, setLoading] = useState(true)
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

  const fetchShipments = useCallback(async () => {
    try {
      const res = await fetch('/api/seller/shipments')
      if (!res.ok) throw new Error('Kargo listesi yüklenemedi')
      const { data } = await res.json()
      setShipments(data ?? [])
    } catch {
      setError('Kargo listesi yüklenirken hata oluştu')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchShipments()
  }, [fetchShipments])

  async function enterTracking() {
    if (!trackingForm.trackingNumber.trim()) {
      setError('Takip numarası zorunludur')
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
        const body = await res.json()
        setError(body.message ?? 'Takip numarası kaydedilemedi')
        return
      }

      setTrackingModal({ open: false, orderId: '', shipmentId: null })
      setTrackingForm({ trackingNumber: '', cargoProvider: 'yurtiçi' })
      await fetchShipments()
    } catch {
      setError('Takip numarası kaydedilemedi')
    } finally {
      setSubmitting(false)
    }
  }

  const cargoProviders = ['yurtiçi', 'aras', 'ptt', 'mng', 'sürat', 'ups', 'fedex', 'dhl']

  function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString('tr-TR', {
      day: '2-digit', month: 'short', year: 'numeric',
    })
  }

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Spinner />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Kargolar"
        description={`${shipments.length} kargo kaydı`}
      />

      {error && (
        <div
          className="flex items-center gap-2 rounded-lg border px-4 py-3 text-sm"
          style={{ borderColor: 'var(--color-danger)', color: 'var(--color-danger)' }}
        >
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
          <button className="ml-auto" onClick={() => setError(null)}>✕</button>
        </div>
      )}

      {shipments.length === 0 ? (
        <EmptyState
          icon={<Truck className="h-12 w-12" />}
          title="Henüz kargo kaydı yok"
          description="Siparişlerinizi hazırladıkça kargo bilgileri burada görünecek."
          action={<Link href="/siparisler"><Button variant="outline">Siparişlere Git</Button></Link>}
        />
      ) : (
        <div
          className="rounded-xl border overflow-x-auto"
          style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
        >
          <table className="w-full text-sm">
            <thead style={{ backgroundColor: 'var(--color-muted)' }}>
              <tr>
                {['Sipariş', 'Kargo Firması', 'Takip No', 'Son Durum', 'Tarih', 'İşlem'].map((h) => (
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
              {shipments.map((s) => (
                <tr key={s.id} className="border-t" style={{ borderColor: 'var(--color-border)' }}>
                  <td className="px-4 py-3">
                    <Link
                      href={`/siparisler/${s.orderId}`}
                      className="font-medium hover:underline"
                      style={{ color: 'var(--color-primary)' }}
                    >
                      #{s.orderId.slice(-8).toUpperCase()}
                    </Link>
                    <div className="text-xs mt-0.5" style={{ color: 'var(--color-muted-fg)' }}>
                      ₺{Number(s.order.totalAmount).toLocaleString('tr-TR')}
                    </div>
                  </td>
                  <td className="px-4 py-3" style={{ color: 'var(--color-muted-fg)' }}>
                    {s.cargoProvider}
                  </td>
                  <td className="px-4 py-3">
                    {s.trackingNumber ? (
                      <span className="font-mono text-xs" style={{ color: 'var(--color-primary)' }}>
                        {s.trackingNumber}
                      </span>
                    ) : (
                      <span className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                        Girilmedi
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={s.status} />
                  </td>
                  <td className="px-4 py-3 text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                    {formatDate(s.createdAt)}
                  </td>
                  <td className="px-4 py-3">
                    {!s.trackingNumber && (
                      <button
                        onClick={() =>
                          setTrackingModal({ open: true, orderId: s.orderId, shipmentId: s.id })
                        }
                        className="flex items-center gap-1 text-xs rounded-lg border px-2.5 py-1.5 transition-colors hover:bg-[var(--color-muted)]"
                        style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)' }}
                      >
                        <Plus className="h-3 w-3" />
                        Takip gir
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Takip numarası giriş modalı */}
      {trackingModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0"
            style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
            onClick={() => setTrackingModal({ open: false, orderId: '', shipmentId: null })}
          />
          <div
            className="relative z-10 w-full max-w-md rounded-xl border p-6 shadow-xl"
            style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
          >
            <div className="flex items-center gap-2 mb-4">
              <Package className="h-5 w-5" style={{ color: 'var(--color-accent)' }} />
              <h3 className="font-semibold" style={{ color: 'var(--color-primary)' }}>
                Kargo Takip Numarası
              </h3>
            </div>

            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                  Kargo Firması
                </label>
                <select
                  value={trackingForm.cargoProvider}
                  onChange={(e) =>
                    setTrackingForm((prev) => ({ ...prev, cargoProvider: e.target.value }))
                  }
                  className="w-full rounded-lg border px-3 py-2 text-sm"
                  style={{
                    borderColor: 'var(--color-border)',
                    backgroundColor: 'var(--color-bg)',
                    color: 'var(--color-primary)',
                  }}
                >
                  {cargoProviders.map((p) => (
                    <option key={p} value={p}>
                      {p.charAt(0).toUpperCase() + p.slice(1)} Kargo
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                  Takip Numarası *
                </label>
                <input
                  type="text"
                  placeholder="Örn: YK20261234567"
                  value={trackingForm.trackingNumber}
                  onChange={(e) =>
                    setTrackingForm((prev) => ({ ...prev, trackingNumber: e.target.value }))
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
                style={{ backgroundColor: 'var(--color-muted)', color: 'var(--color-muted-fg)' }}
              >
                <strong>Not:</strong> Takip numarasını girdikten sonra sipariş &quot;Kargoya verildi&quot;
                durumuna geçecek ve müşteri bilgilendirilecek.
              </div>
            </div>

            <div className="mt-5 flex gap-3">
              <Button
                onClick={enterTracking}
                disabled={submitting}
                className="flex-1"
              >
                {submitting ? 'Kaydediliyor...' : 'Kaydet ve Kargoya Ver'}
              </Button>
              <Button
                variant="ghost"
                onClick={() => setTrackingModal({ open: false, orderId: '', shipmentId: null })}
                disabled={submitting}
              >
                İptal
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
