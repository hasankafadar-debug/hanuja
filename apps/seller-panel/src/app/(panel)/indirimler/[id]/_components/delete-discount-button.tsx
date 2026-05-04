'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@hanuja/ui'
import { Trash2 } from 'lucide-react'

export function DeleteDiscountButton({ ruleId }: { ruleId: string }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleDelete() {
    if (!confirm('Bu kampanyayi silmek istediginizden emin misiniz?')) return
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/seller/discounts/${ruleId}`, { method: 'DELETE' })
      if (response.ok) {
        router.push('/indirimler')
        router.refresh()
      } else {
        const payload = await response.json().catch(() => ({}))
        setError(payload.error ?? 'Kampanya silinemedi. Lutfen tekrar deneyin.')
      }
    } catch {
      setError('Baglanti hatasi olustu.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-2">
      <Button type="button" variant="destructive" onClick={handleDelete} disabled={loading}>
        <Trash2 className="h-4 w-4" />
        {loading ? 'Siliniyor...' : 'Kampanyayi Sil'}
      </Button>
      {error && (
        <p className="text-sm" style={{ color: 'var(--color-destructive)' }}>
          {error}
        </p>
      )}
    </div>
  )
}
