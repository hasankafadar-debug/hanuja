'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Button, EmptyState, ProductCard, Spinner, useToast } from '@hanuja/ui'
import { Heart } from 'lucide-react'
import { csrfFetch } from '@/lib/csrf-fetch'

interface FavoriteProduct {
  id: string
  slug: string
  name: string
  price: number | string
  compareAtPrice: number | string | null
  imageUrl: string | null
  imageUrls?: string[]
  sellerName: string | null
  sellerSlug: string | null
}

function getApiMessage(payload: unknown, fallback: string) {
  if (typeof payload === 'object' && payload !== null) {
    if ('message' in payload && typeof payload.message === 'string') return payload.message
    if ('error' in payload && typeof payload.error === 'string') return payload.error
  }

  return fallback
}

export default function FavoritesPage() {
  const router = useRouter()
  const { toast } = useToast()
  const [favorites, setFavorites] = useState<FavoriteProduct[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [removingId, setRemovingId] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    async function loadFavorites() {
      try {
        const res = await fetch('/api/user/favorites', { cache: 'no-store' })

        if (res.status === 401) {
          if (active) {
            setError('Favorilerinizi görmek için giriş yapmanız gerekiyor.')
          }
          return
        }

        const payload = await res.json().catch(() => null)
        if (!res.ok) {
          if (active) {
            setError(payload?.message ?? 'Favoriler yüklenemedi.')
          }
          return
        }

        if (active) {
          setFavorites(Array.isArray(payload?.data) ? payload.data : [])
        }
      } catch {
        if (active) {
          setError('Favoriler yüklenemedi.')
        }
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    }

    void loadFavorites()

    return () => {
      active = false
    }
  }, [])

  async function handleToggleFavorite(productId: string, nextState: boolean) {
    if (nextState || removingId) return

    setRemovingId(productId)

    try {
      const response = await csrfFetch(`/api/user/favorites/${productId}`, {
        method: 'DELETE',
      })

      if (response.status === 401) {
        router.push(`/giris?callbackUrl=${encodeURIComponent('/hesabim/favoriler')}`)
        return
      }

      const payload = await response.json().catch(() => null)

      if (!response.ok) {
        toast({
          title: 'Favorilerden çıkarılamadı',
          description: getApiMessage(payload, 'Lütfen tekrar deneyin.'),
          variant: 'destructive',
        })
        return
      }

      setFavorites((items) => items.filter((item) => item.id !== productId))
      toast({
        title: 'Favorilerden çıkarıldı',
        description: 'Ürün Favorilerim listesinden kaldırıldı.',
        variant: 'success',
      })
    } finally {
      setRemovingId(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner />
      </div>
    )
  }

  return (
    <div>
      <h1
        className="mb-2 text-xl font-bold"
        style={{ color: 'var(--color-primary)', fontFamily: 'var(--font-display)' }}
      >
        Favorilerim
      </h1>

      {error ? (
        <p className="rounded-lg px-4 py-3 text-sm" style={{ backgroundColor: '#fee2e2', color: '#dc2626' }}>
          {error}
        </p>
      ) : favorites.length === 0 ? (
        <EmptyState
          icon={<Heart className="h-5 w-5" />}
          title="Henüz favori ürününüz yok"
          description="Beğendiğiniz ürünleri kalp ikonuyla kaydedin, sonra burada kolayca tekrar bulun."
          action={
            <Button asChild>
              <Link href="/kategori">Ürünleri Keşfet</Link>
            </Button>
          }
          className="mt-6"
        />
      ) : (
        <>
          <p className="mb-6 text-sm" style={{ color: 'var(--color-muted-fg)' }}>
            Kaydettiğiniz ürünleri daha sonra buradan hızlıca inceleyebilirsiniz.
          </p>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {favorites.map((item) => (
              <ProductCard
                key={item.id}
                id={item.id}
                title={item.name}
                slug={item.slug}
                imageUrl={item.imageUrl}
                imageUrls={item.imageUrls ?? (item.imageUrl ? [item.imageUrl] : [])}
                price={Number(item.price)}
                comparePrice={item.compareAtPrice == null ? null : Number(item.compareAtPrice)}
                {...(item.sellerName ? { sellerName: item.sellerName } : {})}
                {...(item.sellerSlug ? { sellerSlug: item.sellerSlug } : {})}
                isFavorited
                favoriteLoading={removingId === item.id}
                onToggleFavorite={handleToggleFavorite}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
