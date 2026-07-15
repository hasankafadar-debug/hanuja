'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { csrfFetch } from '@/lib/csrf-fetch'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Textarea,
} from '@hanuja/ui'

interface ProductModerationActionsProps {
  productId: string
  defaultRejectReason?: string
  status?: 'pending_review' | 'published' | 'rejected' | 'draft' | 'unlisted'
}

export function ProductModerationActions({
  productId,
  defaultRejectReason,
  status = 'pending_review',
}: ProductModerationActionsProps) {
  const router = useRouter()
  const [loading, setLoading] = useState<'approve' | 'reject' | null>(null)
  const [managementLoading, setManagementLoading] = useState<'unlist' | 'delete' | null>(null)
  const [isRejectOpen, setIsRejectOpen] = useState(false)
  const [rejectReason, setRejectReason] = useState(defaultRejectReason ?? '')
  const [managementMessage, setManagementMessage] = useState<string | null>(null)

  const busy = loading !== null || managementLoading !== null

  async function handleApprove() {
    setLoading('approve')
    try {
      await csrfFetch(`/api/admin/products/${productId}/approve`, { method: 'POST' })
      router.refresh()
    } finally {
      setLoading(null)
    }
  }

  async function handleReject() {
    setLoading('reject')
    try {
      await csrfFetch(`/api/admin/products/${productId}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: rejectReason.trim() || undefined }),
      })
      setIsRejectOpen(false)
      router.refresh()
    } finally {
      setLoading(null)
    }
  }

  async function handleUnlist() {
    setManagementLoading('unlist')
    setManagementMessage(null)
    try {
      const response = await csrfFetch(`/api/admin/products/${productId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'unlisted' }),
      })
      const payload = (await response.json().catch(() => ({}))) as { message?: string }
      if (!response.ok) {
        setManagementMessage(payload.message ?? 'Ürün yayından kaldırılamadı.')
        return
      }
      setManagementMessage('Ürün yayından kaldırıldı.')
      router.refresh()
    } finally {
      setManagementLoading(null)
    }
  }

  async function handleDelete() {
    const confirmed = window.confirm('Bu ürünü kalıcı olarak silmek istediğinize emin misiniz?')
    if (!confirmed) return

    setManagementLoading('delete')
    setManagementMessage(null)
    try {
      const response = await csrfFetch(`/api/admin/products/${productId}`, { method: 'DELETE' })
      const payload = (await response.json().catch(() => ({}))) as { message?: string }
      if (response.ok) {
        router.push('/urunler')
        router.refresh()
        return
      }
      setManagementMessage(payload.message ?? 'Ürün silinemedi.')
    } finally {
      setManagementLoading(null)
    }
  }

  return (
    <>
      <div className="flex gap-2">
        {status === 'pending_review' ? (
          <>
            <Button size="sm" onClick={handleApprove} disabled={busy}>
              {loading === 'approve' ? '...' : 'Onayla'}
            </Button>
            <Button size="sm" variant="destructive" onClick={() => setIsRejectOpen(true)} disabled={busy}>
              {loading === 'reject' ? '...' : 'Reddet'}
            </Button>
          </>
        ) : (
          <>
            {status === 'published' ? (
              <Button size="sm" variant="outline" onClick={handleUnlist} disabled={busy}>
                {managementLoading === 'unlist' ? '...' : 'Yayindan Kaldir'}
              </Button>
            ) : null}
            <Button size="sm" variant="destructive" onClick={handleDelete} disabled={busy}>
              {managementLoading === 'delete' ? '...' : 'Sil'}
            </Button>
          </>
        )}
      </div>
      {managementMessage ? (
        <p className="mt-2 text-sm" role="status">
          {managementMessage}
        </p>
      ) : null}

      <Dialog open={isRejectOpen} onOpenChange={setIsRejectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Urunu Reddet</DialogTitle>
            <DialogDescription>
              Saticiya gosterilecek gerekceyi duzenleyin. Bulgulara gore onerilen metni degistirebilirsiniz.
            </DialogDescription>
          </DialogHeader>

          <Textarea
            value={rejectReason}
            onChange={(event) => setRejectReason(event.target.value)}
            placeholder="Reddetme gerekcesi"
            rows={6}
          />

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsRejectOpen(false)} disabled={busy}>
              Vazgec
            </Button>
            <Button variant="destructive" onClick={handleReject} disabled={busy}>
              {loading === 'reject' ? 'Kaydediliyor...' : 'Reddet'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
