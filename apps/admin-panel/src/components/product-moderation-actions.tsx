'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
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

  const busy = loading !== null || managementLoading !== null

  async function handleApprove() {
    setLoading('approve')
    try {
      await fetch(`/api/admin/products/${productId}/approve`, { method: 'POST' })
      router.refresh()
    } finally {
      setLoading(null)
    }
  }

  async function handleReject() {
    setLoading('reject')
    try {
      await fetch(`/api/admin/products/${productId}/reject`, {
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
    try {
      await fetch(`/api/admin/products/${productId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'unlisted' }),
      })
      router.refresh()
    } finally {
      setManagementLoading(null)
    }
  }

  async function handleDelete() {
    const confirmed = window.confirm('Bu urunu silmek istediginize emin misiniz?')
    if (!confirmed) return

    setManagementLoading('delete')
    try {
      const response = await fetch(`/api/admin/products/${productId}`, { method: 'DELETE' })
      if (response.ok) {
        router.push('/urunler')
        router.refresh()
      }
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
