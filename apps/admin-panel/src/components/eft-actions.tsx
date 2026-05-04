'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@hanuja/ui'

interface EftActionsProps {
  orderId: string
}

interface ApproveModalState {
  open: boolean
  discountType: 'none' | 'try' | 'pct'
  discountValue: string
  discountReason: string
  evidenceNote: string
}

const INITIAL_MODAL: ApproveModalState = {
  open: false,
  discountType: 'none',
  discountValue: '',
  discountReason: '',
  evidenceNote: '',
}

export function EftActions({ orderId }: EftActionsProps) {
  const router = useRouter()
  const [loading, setLoading] = useState<'approve' | 'reject' | null>(null)
  const [modal, setModal] = useState<ApproveModalState>(INITIAL_MODAL)
  const [rejectReason, setRejectReason] = useState('Dekont doğrulanamadı')
  const [showReject, setShowReject] = useState(false)

  function openApproveModal() {
    setModal({ ...INITIAL_MODAL, open: true })
  }

  async function submitApprove() {
    setLoading('approve')
    try {
      let discountAmount: number | undefined
      if (modal.discountType !== 'none' && modal.discountValue) {
        const raw = parseFloat(modal.discountValue)
        if (!isNaN(raw) && raw > 0) {
          // discountValue is TRY — convert to kuruş (cents)
          discountAmount = Math.round(raw * 100)
        }
      }

      const body: Record<string, unknown> = {}
      if (modal.evidenceNote) body.evidenceNote = modal.evidenceNote
      if (discountAmount !== undefined) {
        body.discountAmount = discountAmount
        body.discountReason = modal.discountReason || 'Admin onayı'
      }

      await fetch(`/api/admin/payments/eft/${orderId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      setModal(INITIAL_MODAL)
      router.refresh()
    } finally {
      setLoading(null)
    }
  }

  async function submitReject() {
    setLoading('reject')
    try {
      await fetch(`/api/admin/payments/eft/${orderId}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: rejectReason }),
      })
      setShowReject(false)
      router.refresh()
    } finally {
      setLoading(null)
    }
  }

  return (
    <>
      <div className="flex gap-2 shrink-0">
        <Button size="sm" onClick={openApproveModal} disabled={loading !== null}>
          Onayla
        </Button>
        <Button
          size="sm"
          variant="destructive"
          onClick={() => setShowReject(true)}
          disabled={loading !== null}
        >
          Reddet
        </Button>
      </div>

      {/* Onay modalı — indirim opsiyonel */}
      {modal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div data-testid="eft-approval-panel" className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h3 className="mb-4 text-base font-semibold">Havale Onayı</h3>

            <label className="mb-1 block text-sm font-medium">Dekont notu (opsiyonel)</label>
            <input
              type="text"
              className="mb-4 w-full rounded border px-3 py-2 text-sm"
              placeholder="Dekont referans no veya not"
              value={modal.evidenceNote}
              onChange={(e) => setModal((m) => ({ ...m, evidenceNote: e.target.value }))}
            />

            <label className="mb-1 block text-sm font-medium">İndirim uygula</label>
            <select
              className="mb-3 w-full rounded border px-3 py-2 text-sm"
              value={modal.discountType}
              onChange={(e) =>
                setModal((m) => ({
                  ...m,
                  discountType: e.target.value as ApproveModalState['discountType'],
                  discountValue: '',
                }))
              }
            >
              <option value="none">İndirim yok</option>
              <option value="try">TRY tutarı gir</option>
            </select>

            {modal.discountType !== 'none' && (
              <>
                <label className="mb-1 block text-sm font-medium">
                  İndirim tutarı (₺)
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className="mb-3 w-full rounded border px-3 py-2 text-sm"
                  placeholder="ör. 25.00"
                  value={modal.discountValue}
                  onChange={(e) => setModal((m) => ({ ...m, discountValue: e.target.value }))}
                />
                <label className="mb-1 block text-sm font-medium">İndirim gerekçesi</label>
                <input
                  type="text"
                  className="mb-4 w-full rounded border px-3 py-2 text-sm"
                  placeholder="Neden indirim uygulandı?"
                  value={modal.discountReason}
                  onChange={(e) => setModal((m) => ({ ...m, discountReason: e.target.value }))}
                />
              </>
            )}

            <div className="flex justify-end gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setModal(INITIAL_MODAL)}
                disabled={loading === 'approve'}
              >
                İptal
              </Button>
              <Button data-testid="eft-confirm-approve" size="sm" onClick={submitApprove} disabled={loading === 'approve'}>
                {loading === 'approve' ? 'İşleniyor...' : 'Onayla'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Reddetme modalı */}
      {showReject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
            <h3 className="mb-4 text-base font-semibold text-red-700">Havaleyi Reddet</h3>
            <label className="mb-1 block text-sm font-medium">Red gerekçesi</label>
            <textarea
              className="mb-4 w-full rounded border px-3 py-2 text-sm"
              rows={3}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
            />
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => setShowReject(false)}>
                İptal
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={submitReject}
                disabled={loading === 'reject' || !rejectReason.trim()}
              >
                {loading === 'reject' ? 'İşleniyor...' : 'Reddet'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
