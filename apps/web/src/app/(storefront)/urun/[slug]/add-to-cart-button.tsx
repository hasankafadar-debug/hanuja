'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@hanuja/ui'
import { ShoppingCart, Heart } from 'lucide-react'

interface Props {
  productId: string
  stock: number
}

export default function AddToCartButton({ productId, stock }: Props) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [added, setAdded] = useState(false)

  async function handleAddToCart() {
    if (stock <= 0) return
    setLoading(true)
    try {
      const res = await fetch('/api/cart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId, quantity: 1 }),
      })
      if (res.status === 401) {
        router.push('/giris?redirect=' + encodeURIComponent(window.location.pathname))
        return
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        alert(data?.message ?? 'Sepete eklenemedi. Lütfen tekrar deneyin.')
        return
      }
      setAdded(true)
      setTimeout(() => setAdded(false), 2000)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex gap-3">
      <Button
        className="flex-1 gap-2"
        size="lg"
        disabled={stock <= 0 || loading}
        onClick={handleAddToCart}
      >
        <ShoppingCart className="h-5 w-5" />
        {loading ? 'Ekleniyor...' : added ? '✓ Sepete Eklendi' : stock <= 0 ? 'Stokta Yok' : 'Sepete Ekle'}
      </Button>
      <Button variant="outline" size="lg" aria-label="Favorilere ekle" disabled>
        <Heart className="h-5 w-5" />
      </Button>
    </div>
  )
}
