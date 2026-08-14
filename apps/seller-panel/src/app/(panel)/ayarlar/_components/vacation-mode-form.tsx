'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Info } from 'lucide-react'
import {
  ConfirmDialog,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  useToast,
} from '@hanuja/ui'
import { csrfFetch } from '@/lib/csrf-fetch'

const VACATION_MODE_INFO =
  'Bu modu aktifleştirdiğinizde tekrar kapatana kadar ürünleriniz satıştan gizlenir. Kapatıp tekrar satışa çıktığınızda görünürlük sıralamanız düşer.'

export default function VacationModeForm({ enabled }: { enabled: boolean }) {
  const router = useRouter()
  const { toast } = useToast()
  const [isEnabled, setIsEnabled] = useState(enabled)
  const [loading, setLoading] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)

  async function updateVacationMode(nextEnabled: boolean) {
    if (loading) return
    setLoading(true)

    try {
      const response = await csrfFetch('/api/seller/vacation-mode', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: nextEnabled }),
      })
      const payload = (await response.json().catch(() => null)) as
        | { error?: string; vacationModeEnabled?: boolean }
        | null

      if (!response.ok) {
        toast({
          title: 'İşlem başarısız',
          description: payload?.error ?? 'Tatil Modu güncellenemedi.',
          variant: 'destructive',
        })
        return
      }

      setIsEnabled(payload?.vacationModeEnabled ?? nextEnabled)
      setConfirmOpen(false)
      toast({
        title: nextEnabled ? 'Tatil Modu açıldı' : 'Tatil Modu kapatıldı',
        description: nextEnabled
          ? 'Ürünleriniz siz Tatil Modu’nu kapatana kadar satıştan gizlendi.'
          : 'Yayındaki ürünleriniz yeniden satışa açıldı.',
        variant: 'success',
      })
      router.refresh()
    } catch {
      toast({
        title: 'Bağlantı hatası',
        description: 'Lütfen bağlantınızı kontrol edip tekrar deneyin.',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }

  function handleToggle() {
    if (isEnabled) {
      void updateVacationMode(false)
      return
    }
    setConfirmOpen(true)
  }

  return (
    <>
      <div
        className="rounded-xl border p-5"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
      >
        <div className="flex items-start justify-between gap-6">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <h2 className="font-semibold" style={{ color: 'var(--color-primary)' }}>
                Tatil Modu
              </h2>
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-label="Tatil Modu hakkında bilgi"
                      className="rounded-full p-0.5 focus-visible:outline-none focus-visible:ring-2"
                      style={{ color: 'var(--color-muted-fg)' }}
                    >
                      <Info className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-xs">
                    {VACATION_MODE_INFO}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <p className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>
              Mağazanızın satışlarını geçici olarak duraklatın.
            </p>
            <p className="text-sm font-medium" style={{ color: 'var(--color-primary)' }}>
              Durum: {isEnabled ? 'Tatil Modu açık' : 'Satışta'}
            </p>
          </div>

          <button
            type="button"
            role="switch"
            aria-checked={isEnabled}
            aria-label="Tatil Modu"
            disabled={loading}
            onClick={handleToggle}
            className="relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-60"
            style={{
              backgroundColor: isEnabled ? 'var(--color-accent)' : 'var(--color-border)',
            }}
          >
            <span
              aria-hidden="true"
              className={`inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
                isEnabled ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Tatil Modu’nu açmak istiyor musunuz?"
        description="Yayındaki tüm ürünleriniz müşterilerden gizlenecek ve müşterilerin sepetlerindeki mağazanıza ait ürünler kaldırılacak. Mevcut siparişlerinizi karşılamaya devam etmeniz gerekir."
        confirmLabel="Tatil Modu’nu Aç"
        cancelLabel="Vazgeç"
        loading={loading}
        onConfirm={() => void updateVacationMode(true)}
      />
    </>
  )
}
