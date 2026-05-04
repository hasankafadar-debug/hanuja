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
}

export function ProductModerationActions({
  productId,
  defaultRejectReason,
}: ProductModerationActionsProps) {
  const router = useRouter()
  const [loading, setLoading] = useState<'approve' | 'reject' | null>(null)
  const [isRejectOpen, setIsRejectOpen] = useState(false)
  const [rejectReason, setRejectReason] = useState(defaultRejectReason ?? '')

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

  return (
    <>
      <div className="flex gap-2">
        <Button size="sm" onClick={handleApprove} disabled={loading !== null}>
          {loading === 'approve' ? '...' : 'Onayla'}
        </Button>
        <Button size="sm" variant="destructive" onClick={() => setIsRejectOpen(true)} disabled={loading !== null}>
          {loading === 'reject' ? '...' : 'Reddet'}
        </Button>
      </div>

      <Dialog open={isRejectOpen} onOpenChange={setIsRejectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ürünü Reddet</DialogTitle>
            <DialogDescription>
              Satıcıya gösterilecek gerekçeyi düzenleyin. Bulgulara göre önerilen metni değiştirebilirsiniz.
            </DialogDescription>
          </DialogHeader>

          <Textarea
            value={rejectReason}
            onChange={(event) => setRejectReason(event.target.value)}
            placeholder="Reddetme gerekçesi"
            rows={6}
          />

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsRejectOpen(false)} disabled={loading !== null}>
              Vazgeç
            </Button>
            <Button variant="destructive" onClick={handleReject} disabled={loading !== null}>
              {loading === 'reject' ? 'Kaydediliyor...' : 'Reddet'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
