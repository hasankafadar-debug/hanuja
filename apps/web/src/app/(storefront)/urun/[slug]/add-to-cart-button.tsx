'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, useToast } from '@hanuja/ui'
import { Heart, Share2, ShoppingCart } from 'lucide-react'
import { csrfFetch } from '@/lib/csrf-fetch'

interface Props {
  productId: string
  productName: string
  basePrice: number
  compareAtPrice?: number | null
  fulfillmentDays?: number | null
  stock: number
  // Ürün ölçüleri satırı (ör. "En: 100 cm · Boy: 30 cm"); ölçü yoksa null.
  dimensionText?: string | null
  variants?: Array<{
    id: string
    name: string
    price: number | null
    stockQuantity: number
    options: Record<string, string>
  }>
}

function getApiMessage(payload: unknown, fallback: string) {
  if (typeof payload === 'object' && payload !== null) {
    if ('message' in payload && typeof payload.message === 'string') return payload.message
    if ('error' in payload && typeof payload.error === 'string') return payload.error
  }

  return fallback
}

export default function AddToCartButton({
  productId,
  productName,
  basePrice,
  compareAtPrice = null,
  fulfillmentDays = null,
  stock,
  dimensionText = null,
  variants = [],
}: Props) {
  const router = useRouter()
  const { toast } = useToast()
  const [loading, setLoading] = useState(false)
  const [added, setAdded] = useState(false)
  const [favoriteLoading, setFavoriteLoading] = useState(false)
  const [favoriteKnown, setFavoriteKnown] = useState(false)
  const [isFavorite, setIsFavorite] = useState(false)
  const [shareLoading, setShareLoading] = useState(false)
  const [selectedVariantId, setSelectedVariantId] = useState(variants[0]?.id ?? '')
  const selectedVariant = variants.find((variant) => variant.id === selectedVariantId) ?? null
  const availableStock = selectedVariant?.stockQuantity ?? stock
  const displayPrice = selectedVariant?.price ?? basePrice
  const displayCompareAtPrice = compareAtPrice && compareAtPrice > displayPrice ? compareAtPrice : null
  const fulfillmentText =
    typeof fulfillmentDays === 'number' ? `Sevk Süresi: ${fulfillmentDays} iş günü` : null

  useEffect(() => {
    let active = true

    async function loadFavoriteState() {
      try {
        const res = await fetch(`/api/user/favorites/${productId}`, { cache: 'no-store' })

        if (res.status === 401) {
          if (active) setIsFavorite(false)
          return
        }

        if (!res.ok) return

        const payload = await res.json().catch(() => null)
        if (active) {
          setIsFavorite(Boolean(payload?.data?.isFavorite))
        }
      } finally {
        if (active) {
          setFavoriteKnown(true)
        }
      }
    }

    void loadFavoriteState()

    return () => {
      active = false
    }
  }, [productId])

  async function handleAddToCart() {
    if (availableStock <= 0 || (variants.length > 0 && !selectedVariantId)) return
    setLoading(true)
    try {
      const res = await csrfFetch('/api/cart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId,
          quantity: 1,
          ...(selectedVariantId ? { variantId: selectedVariantId } : {}),
        }),
      })

      if (res.status === 401) {
        router.push('/giris?callbackUrl=' + encodeURIComponent(window.location.pathname))
        return
      }

      if (!res.ok) {
        const data = await res.json().catch(() => null)
        toast({
          title: 'Sepete eklenemedi',
          description: getApiMessage(data, 'Lütfen tekrar deneyin.'),
          variant: 'destructive',
        })
        return
      }

      setAdded(true)
      toast({
        title: 'Sepete eklendi',
        description: 'Ürün sepetinize eklendi.',
        variant: 'success',
      })
      window.dispatchEvent(new CustomEvent('hanuja:cart-changed'))
      setTimeout(() => setAdded(false), 2000)
    } finally {
      setLoading(false)
    }
  }

  async function handleToggleFavorite() {
    const nextFavorite = !isFavorite
    setFavoriteLoading(true)

    try {
      const res = await csrfFetch(
        nextFavorite ? '/api/user/favorites' : `/api/user/favorites/${productId}`,
        nextFavorite
          ? {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ productId }),
            }
          : { method: 'DELETE' },
      )

      if (res.status === 401) {
        router.push('/giris?callbackUrl=' + encodeURIComponent(window.location.pathname))
        return
      }

      if (!res.ok) {
        const data = await res.json().catch(() => null)
        toast({
          title: 'Favori işlemi başarısız',
          description: getApiMessage(data, 'Lütfen tekrar deneyin.'),
          variant: 'destructive',
        })
        return
      }

      setIsFavorite(nextFavorite)
      setFavoriteKnown(true)
      toast({
        title: nextFavorite ? 'Favorilere eklendi' : 'Favorilerden çıkarıldı',
        description: nextFavorite
          ? 'Ürün Favorilerim listesine kaydedildi.'
          : 'Ürün Favorilerim listesinden kaldırıldı.',
        variant: 'success',
      })
    } finally {
      setFavoriteLoading(false)
    }
  }

  async function handleShare() {
    setShareLoading(true)

    try {
      const url = window.location.href

      if (typeof navigator.share === 'function') {
        await navigator.share({
          title: productName,
          text: `${productName} ürününü incele`,
          url,
        })

        toast({
          title: 'Paylaşım hazır',
          description: 'Ürün paylaşım penceresi açıldı.',
          variant: 'success',
        })
        return
      }

      if (!navigator.clipboard?.writeText) {
        throw new Error('Clipboard unavailable')
      }

      await navigator.clipboard.writeText(url)
      toast({
        title: 'Bağlantı kopyalandı',
        description: 'Ürün linki panoya kopyalandı.',
        variant: 'success',
      })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return
      }

      toast({
        title: 'Paylaşım başarısız',
        description: 'Ürün linki paylaşılamadı. Lütfen tekrar deneyin.',
        variant: 'destructive',
      })
    } finally {
      setShareLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {variants.length > 0 ? (
        <div className="space-y-2">
          <p className="text-sm font-medium" style={{ color: 'var(--color-primary)' }}>
            Varyasyon
          </p>
          <div className="flex flex-wrap gap-2">
            {variants.map((variant) => {
              const selected = variant.id === selectedVariantId
              return (
                <button
                  key={variant.id}
                  type="button"
                  onClick={() => setSelectedVariantId(variant.id)}
                  className="rounded-md border px-3 py-2 text-sm transition-colors"
                  style={{
                    borderColor: selected ? 'var(--color-primary)' : 'var(--color-border)',
                    backgroundColor: selected ? 'var(--color-muted)' : 'var(--color-surface)',
                    color: 'var(--color-primary)',
                  }}
                >
                  {variant.name}
                </button>
              )
            })}
          </div>
          <div className="flex items-center gap-3 pt-1">
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold" style={{ color: 'var(--color-primary)' }}>
                {displayPrice.toLocaleString('tr-TR', { maximumFractionDigits: 0 })} TL
              </span>
              {displayCompareAtPrice ? (
                <span className="text-sm line-through" style={{ color: 'var(--color-muted-fg)' }}>
                  {displayCompareAtPrice.toLocaleString('tr-TR', { maximumFractionDigits: 0 })} TL
                </span>
              ) : null}
            </div>
            <span
              className="flex items-center gap-1 text-sm"
              style={{ color: availableStock > 0 ? 'var(--color-success)' : 'var(--color-destructive)' }}
            >
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: availableStock > 0 ? 'var(--color-success)' : 'var(--color-destructive)' }}
              />
              {availableStock > 0 ? `Stokta (${availableStock} adet)` : 'Stokta yok'}
            </span>
            {fulfillmentText ? (
              <span className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>
                {fulfillmentText}
              </span>
            ) : null}
            {dimensionText ? (
              <span className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>
                {dimensionText}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
      <div className="flex gap-3">
        <Button
          data-testid="add-to-cart"
          className="flex-1 gap-2"
          size="lg"
          disabled={availableStock <= 0 || loading || (variants.length > 0 && !selectedVariantId)}
          onClick={handleAddToCart}
        >
          <ShoppingCart className="h-5 w-5" />
          {loading ? 'Ekleniyor...' : added ? '✓ Sepete Eklendi' : availableStock <= 0 ? 'Stokta Yok' : 'Sepete Ekle'}
        </Button>
        <Button
          variant="outline"
          size="lg"
          aria-label={isFavorite ? 'Favorilerden çıkar' : 'Favorilere ekle'}
          disabled={favoriteLoading}
          onClick={handleToggleFavorite}
        >
          <Heart
            className={`h-5 w-5 ${favoriteKnown && isFavorite ? 'fill-current text-[var(--color-accent)]' : ''}`}
          />
        </Button>
      </div>

      <Button variant="outline" size="lg" loading={shareLoading} onClick={handleShare}>
        {!shareLoading && <Share2 className="h-5 w-5" />}
        Ürünü Paylaş
      </Button>
    </div>
  )
}
