'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@hanuja/ui'
import { CheckCircle2, PackageCheck, Truck } from 'lucide-react'
import {
  getAvailableSellerWorkflowActions,
  getSellerWorkflowStep,
} from '@/lib/seller-order-workflow'
import RejectButton from './reject-button'
import ExtensionRequestButton from './extension-request-button'

interface OrderWorkflowCardProps {
  orderId: string
  status: string
  trackingNumber?: string | null
  cargoProvider?: string | null
  canRequestExtension: boolean
  pendingRequestId: string | null
}

const CARGO_PROVIDERS = ['yurtici', 'aras', 'ptt', 'mng', 'surat', 'ups', 'fedex', 'dhl', 'diger']

const CARGO_PROVIDER_LABELS: Record<string, string> = {
  yurtici: 'Yurtici Kargo',
  aras: 'Aras Kargo',
  ptt: 'PTT Kargo',
  mng: 'MNG Kargo',
  surat: 'Surat Kargo',
  ups: 'UPS',
  fedex: 'FedEx',
  dhl: 'DHL',
  diger: 'Diger',
}

function isKnownProvider(value: string) {
  return CARGO_PROVIDERS.includes(value)
}

export default function OrderWorkflowCard({
  orderId,
  status,
  trackingNumber,
  cargoProvider,
  canRequestExtension,
  pendingRequestId,
}: OrderWorkflowCardProps) {
  const router = useRouter()
  const [loadingAction, setLoadingAction] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const initialProvider = cargoProvider
    ? isKnownProvider(cargoProvider)
      ? cargoProvider
      : 'diger'
    : 'yurtici'
  const initialCustomName = cargoProvider && !isKnownProvider(cargoProvider) ? cargoProvider : ''
  const [selectedCargoProvider, setSelectedCargoProvider] = useState(initialProvider)
  const [customCargoName, setCustomCargoName] = useState(initialCustomName)
  const [trackingValue, setTrackingValue] = useState(trackingNumber ?? '')

  const currentStep = useMemo(() => getSellerWorkflowStep(status), [status])
  const actions = useMemo(() => getAvailableSellerWorkflowActions(status), [status])
  const canReject = ['seller_queue_ready', 'seller_reviewing'].includes(status)

  const resolvedCargoProvider =
    selectedCargoProvider === 'diger' ? customCargoName.trim() : selectedCargoProvider

  async function postAction(action: 'accept' | 'preparing' | 'awaiting' | 'tracking') {
    setLoadingAction(action)
    setError(null)

    if ((action === 'awaiting' || action === 'tracking') && !resolvedCargoProvider) {
      setError('Kargo firması adı boş bırakılamaz.')
      setLoadingAction(null)
      return
    }

    try {
      let endpoint = ''
      let body: Record<string, string> | undefined

      if (action === 'accept') {
        endpoint = `/api/seller/orders/${orderId}/accept`
      } else if (action === 'preparing') {
        endpoint = '/api/seller/shipments/preparing'
        body = { orderId }
      } else if (action === 'awaiting') {
        endpoint = '/api/seller/shipments/awaiting'
        body = { orderId, cargoProvider: resolvedCargoProvider }
      } else {
        endpoint = '/api/seller/shipments/tracking'
        body = {
          orderId,
          cargoProvider: resolvedCargoProvider,
          trackingNumber: trackingValue.trim(),
        }
      }

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        setError(data.message ?? data.error ?? 'İşlem tamamlanamadı.')
        return
      }

      router.refresh()
    } catch {
      setError('Bağlantı hatası oluştu.')
    } finally {
      setLoadingAction(null)
    }
  }

  const actionColumns = canRequestExtension ? 'md:grid-cols-3' : 'md:grid-cols-2'

  return (
    <section
      className="rounded-xl border p-5"
      style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
    >
      <div className="mb-4">
        <h2 className="text-base font-semibold" style={{ color: 'var(--color-primary)' }}>
          Sipariş Süreci
        </h2>
        <p className="mt-1 text-sm" style={{ color: 'var(--color-muted-fg)' }}>
          Siparişi manuel olarak adım adım ilerletin.
        </p>
      </div>

      <div className="mb-5 grid gap-3 md:grid-cols-4">
        {[
          { label: 'Siparişi Onayla', icon: <CheckCircle2 className="h-4 w-4" />, step: 1 },
          { label: 'Hazırlamaya Başla', icon: <PackageCheck className="h-4 w-4" />, step: 2 },
          { label: 'Kargoya Hazır', icon: <Truck className="h-4 w-4" />, step: 3 },
          { label: 'Kargoya Ver', icon: <Truck className="h-4 w-4" />, step: 4 },
        ].map((item) => {
          const isActive = currentStep >= item.step
          return (
            <div
              key={item.label}
              className="rounded-lg border p-3"
              style={{
                borderColor: isActive ? 'var(--color-accent)' : 'var(--color-border)',
                backgroundColor: isActive ? 'var(--color-muted)' : 'transparent',
              }}
            >
              <div className="mb-2 flex items-center gap-2" style={{ color: 'var(--color-primary)' }}>
                {item.icon}
                <span className="text-sm font-medium">{item.label}</span>
              </div>
              <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                Adım {item.step}
              </p>
            </div>
          )
        })}
      </div>

      {actions.includes('accept') ? (
        <div className="space-y-4">
          <p className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>
            Sipariş ödeme onaylı olarak satıcı kuyruğuna düştü.
          </p>
          <div className={`grid gap-3 ${actionColumns}`}>
            <Button
              loading={loadingAction === 'accept'}
              className="w-full"
              onClick={() => postAction('accept')}
            >
              Siparişi Onayla
            </Button>
            {canRequestExtension ? (
              <ExtensionRequestButton
                orderId={orderId}
                pendingRequestId={pendingRequestId}
                variant="default"
                triggerClassName="w-full"
              />
            ) : null}
            {canReject ? <RejectButton orderId={orderId} /> : null}
          </div>
        </div>
      ) : null}

      {!actions.includes('accept') && canRequestExtension ? (
        <div className="mb-4">
          <ExtensionRequestButton
            orderId={orderId}
            pendingRequestId={pendingRequestId}
            variant="default"
            triggerClassName="w-full md:w-auto"
          />
        </div>
      ) : null}

      {actions.includes('preparing') ? (
        <div className="space-y-3">
          <p className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>
            Onaylanan siparişi hazırlık aşamasına geçirin.
          </p>
          <Button loading={loadingAction === 'preparing'} onClick={() => postAction('preparing')}>
            Hazırlamaya Başla
          </Button>
        </div>
      ) : null}

      {actions.includes('awaiting') ? (
        <div className="space-y-4">
          <p className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>
            Kargo firması seçip siparişi kargoya hazır durumuna getirin.
          </p>
          <label
            htmlFor="workflow-cargo-provider-ready"
            className="block text-sm"
            style={{ color: 'var(--color-primary)' }}
          >
            Kargo Firması
          </label>
          <select
            id="workflow-cargo-provider-ready"
            aria-label="Kargo firması"
            value={selectedCargoProvider}
            onChange={(event) => setSelectedCargoProvider(event.target.value)}
            className="h-10 w-full rounded-lg border px-3 text-sm"
            style={{
              borderColor: 'var(--color-border)',
              backgroundColor: 'var(--color-surface)',
              color: 'var(--color-primary)',
            }}
          >
            {CARGO_PROVIDERS.map((provider) => (
              <option key={provider} value={provider}>
                {CARGO_PROVIDER_LABELS[provider] ?? provider.toUpperCase()}
              </option>
            ))}
          </select>
          {selectedCargoProvider === 'diger' ? (
            <input
              aria-label="Özel kargo firması adı"
              value={customCargoName}
              onChange={(event) => setCustomCargoName(event.target.value)}
              placeholder="Kargo firması adını girin"
              className="h-10 w-full rounded-lg border px-3 text-sm"
              style={{
                borderColor: 'var(--color-border)',
                backgroundColor: 'var(--color-surface)',
                color: 'var(--color-primary)',
              }}
            />
          ) : null}
          <Button
            loading={loadingAction === 'awaiting'}
            disabled={selectedCargoProvider === 'diger' && !customCargoName.trim()}
            onClick={() => postAction('awaiting')}
          >
            Kargoya Hazır
          </Button>
        </div>
      ) : null}

      {actions.includes('tracking') ? (
        <div className="space-y-4">
          <p className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>
            Takip numarasını girdiğinizde sipariş kargoya verilmiş olarak işaretlenir.
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <label
                htmlFor="workflow-cargo-provider-tracking"
                className="mb-2 block text-sm"
                style={{ color: 'var(--color-primary)' }}
              >
                Kargo Firması
              </label>
              <select
                id="workflow-cargo-provider-tracking"
                aria-label="Kargo firması"
                value={selectedCargoProvider}
                onChange={(event) => setSelectedCargoProvider(event.target.value)}
                className="h-10 w-full rounded-lg border px-3 text-sm"
                style={{
                  borderColor: 'var(--color-border)',
                  backgroundColor: 'var(--color-surface)',
                  color: 'var(--color-primary)',
                }}
              >
                {CARGO_PROVIDERS.map((provider) => (
                  <option key={provider} value={provider}>
                    {CARGO_PROVIDER_LABELS[provider] ?? provider.toUpperCase()}
                  </option>
                ))}
              </select>
              {selectedCargoProvider === 'diger' ? (
                <input
                  aria-label="Özel kargo firması adı"
                  value={customCargoName}
                  onChange={(event) => setCustomCargoName(event.target.value)}
                  placeholder="Kargo firması adını girin"
                  className="h-10 w-full rounded-lg border px-3 text-sm"
                  style={{
                    borderColor: 'var(--color-border)',
                    backgroundColor: 'var(--color-surface)',
                    color: 'var(--color-primary)',
                  }}
                />
              ) : null}
            </div>
            <div>
              <label
                htmlFor="workflow-tracking-number"
                className="mb-2 block text-sm"
                style={{ color: 'var(--color-primary)' }}
              >
                Takip Numarası
              </label>
              <input
                id="workflow-tracking-number"
                value={trackingValue}
                onChange={(event) => setTrackingValue(event.target.value)}
                className="h-10 w-full rounded-lg border px-3 text-sm"
                style={{
                  borderColor: 'var(--color-border)',
                  backgroundColor: 'var(--color-surface)',
                  color: 'var(--color-primary)',
                }}
                placeholder="Takip numarası"
              />
            </div>
          </div>
          <Button
            loading={loadingAction === 'tracking'}
            disabled={!trackingValue.trim() || (selectedCargoProvider === 'diger' && !customCargoName.trim())}
            onClick={() => postAction('tracking')}
          >
            Takip No Gir / Kargoya Ver
          </Button>
        </div>
      ) : null}

      {['shipped', 'delivered', 'delivery_confirmation_pending', 'delivery_confirmed'].includes(status) ? (
        <div
          className="rounded-lg border p-4 text-sm"
          style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-muted)' }}
        >
          <p className="font-medium" style={{ color: 'var(--color-primary)' }}>
            Sipariş kargo sürecine girdi.
          </p>
          <p className="mt-1" style={{ color: 'var(--color-muted-fg)' }}>
            {trackingNumber ? `Takip no: ${trackingNumber}` : 'Takip numarası kayıtlı.'}
          </p>
          <p className="mt-1" style={{ color: 'var(--color-muted-fg)' }}>
            {resolvedCargoProvider
              ? `Kargo firması: ${CARGO_PROVIDER_LABELS[resolvedCargoProvider] ?? resolvedCargoProvider}`
              : null}
          </p>
        </div>
      ) : null}

      {error ? (
        <p className="mt-4 text-sm" style={{ color: 'var(--color-destructive)' }}>
          {error}
        </p>
      ) : null}
    </section>
  )
}
