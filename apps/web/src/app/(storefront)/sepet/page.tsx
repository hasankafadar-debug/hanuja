'use client'

import { useState, useEffect, useCallback } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button, EmptyState, Separator, Spinner, normalizeMediaDisplayUrl } from '@hanuja/ui'
import { Trash2, ShoppingCart, Plus, Minus, AlertTriangle } from 'lucide-react'
import { csrfFetch } from '@/lib/csrf-fetch'
import CouponForm from './_components/coupon-form'

interface CartItem {
  id: string
  productId: string
  variantId: string | null
  quantity: number
  unitPrice: string
  product: {
    name: string
    slug: string
    seller: { displayName: string; slug: string }
    images: Array<{ url: string; altText: string | null }>
  } | null
  variant: { name: string } | null
}

interface Cart {
  id: string | null
  items: CartItem[]
  couponCode: string | null
  itemCount: number
  subtotal: string
  grossSubtotal?: string
  netSubtotal?: string
  taxAmount?: string
  taxBreakdown?: Array<{ ratePercent: number; taxAmount: string }>
  couponDiscount?: string
  shipping?: string
  total?: string
  freeShippingThresholdTry?: string
  flatShippingFeeTry?: string
}

function formatPrice(value: string | number) {
  return Number(value).toLocaleString('tr-TR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

export default function CartPage() {
  const router = useRouter()
  const [cart, setCart] = useState<Cart | null>(null)
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const fetchCart = useCallback(async () => {
    try {
      const res = await fetch('/api/cart')
      if (res.status === 401) {
        router.push('/giris?callbackUrl=/sepet')
        return
      }
      if (!res.ok) throw new Error('Sepet yuklenemedi')
      const { data } = await res.json()
      setCart(data)
    } catch {
      setError('Sepet yuklenirken hata olustu')
    } finally {
      setLoading(false)
    }
  }, [router])

  useEffect(() => {
    void fetchCart()
  }, [fetchCart])

  async function updateQuantity(itemId: string, delta: number, currentQty: number) {
    const newQty = currentQty + delta
    if (newQty < 1) return removeItem(itemId)

    setUpdating(itemId)
    try {
      const res = await csrfFetch(`/api/cart/items/${itemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quantity: newQty }),
      })
      if (!res.ok) {
        const body = await res.json()
        setError(body.message ?? 'Guncelleme basarisiz')
        return
      }
      await fetchCart()
      window.dispatchEvent(new CustomEvent('hanuja:cart-changed'))
    } catch {
      setError('Guncelleme sirasinda hata olustu')
    } finally {
      setUpdating(null)
    }
  }

  async function removeItem(itemId: string) {
    setUpdating(itemId)
    try {
      await csrfFetch(`/api/cart/items/${itemId}`, { method: 'DELETE' })
      await fetchCart()
      window.dispatchEvent(new CustomEvent('hanuja:cart-changed'))
    } catch {
      setError('Urun kaldirilirken hata olustu')
    } finally {
      setUpdating(null)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Spinner />
      </div>
    )
  }

  if (!cart || cart.items.length === 0) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-20 sm:px-6 lg:px-8">
        <EmptyState
          icon={<ShoppingCart className="h-12 w-12" />}
          title="Sepetiniz bos"
          description="Begendiginiz urunleri sepete ekleyerek alisverise baslayin."
          action={<Link href="/"><Button>Alisverise Basla</Button></Link>}
        />
      </div>
    )
  }

  const grossSubtotal = Number(cart.grossSubtotal ?? cart.subtotal)
  const netSubtotal = Number(cart.netSubtotal ?? grossSubtotal)
  const couponDiscount = Number(cart.couponDiscount ?? 0)
  const freeShippingThreshold = Number(cart.freeShippingThresholdTry ?? 1500)
  const flatShippingFee = Number(cart.flatShippingFeeTry ?? 99)
  const shipping = Number(cart.shipping ?? (grossSubtotal >= freeShippingThreshold ? 0 : flatShippingFee))
  const total = Number(cart.total ?? (grossSubtotal - couponDiscount + shipping))

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <h1 className="mb-8 text-2xl font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-primary)' }}>
        Sepetim ({cart.itemCount} urun)
      </h1>

      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border px-4 py-3 text-sm" style={{ borderColor: 'var(--color-danger)', color: 'var(--color-danger)' }}>
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
          <button className="ml-auto" onClick={() => setError(null)}>x</button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-10 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4">
          {cart.items.map((item) => {
            const product = item.product
            const image = product?.images[0]
            const lineTotal = Number(item.unitPrice) * item.quantity
            const isUpdating = updating === item.id

            return (
              <div
                key={item.id}
                data-testid="cart-item"
                className="flex gap-4 rounded-xl border p-4"
                style={{
                  borderColor: 'var(--color-border)',
                  backgroundColor: 'var(--color-surface)',
                  opacity: isUpdating ? 0.6 : 1,
                  transition: 'opacity 0.15s',
                }}
              >
                <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg" style={{ backgroundColor: 'var(--color-muted)' }}>
                  {image ? (
                    <Image
                      src={normalizeMediaDisplayUrl(image.url)}
                      alt={image.altText ?? product?.name ?? 'Sepet urunu'}
                      fill
                      sizes="80px"
                      className="object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                      Gorsel yok
                    </div>
                  )}
                </div>

                <div className="flex flex-1 flex-col gap-1">
                  {product ? (
                    <>
                      <Link href={`/urun/${product.slug}`} className="font-medium hover:underline" style={{ color: 'var(--color-primary)' }}>
                        {product.name}
                        {item.variant ? <span className="ml-2 text-xs font-normal" style={{ color: 'var(--color-muted-fg)' }}>({item.variant.name})</span> : null}
                      </Link>
                      <Link href={`/magaza/${product.seller.slug}`} className="text-xs hover:underline" style={{ color: 'var(--color-muted-fg)' }}>
                        {product.seller.displayName}
                      </Link>
                    </>
                  ) : (
                    <>
                      <p className="font-medium" style={{ color: 'var(--color-primary)' }}>Urun artik mevcut degil</p>
                      <p className="text-xs" style={{ color: 'var(--color-danger)' }}>
                        Bu urun yayindan kaldirilmis veya erisilemiyor. Satiri sepetten kaldirabilirsiniz.
                      </p>
                    </>
                  )}

                  <div className="mt-2 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => updateQuantity(item.id, -1, item.quantity)}
                        disabled={isUpdating}
                        className="flex h-7 w-7 items-center justify-center rounded-full border transition-colors hover:bg-[var(--color-muted)]"
                        style={{ borderColor: 'var(--color-border)' }}
                        aria-label="Azalt"
                      >
                        <Minus className="h-3 w-3" />
                      </button>
                      <span className="w-6 text-center text-sm font-medium">{item.quantity}</span>
                      <button
                        onClick={() => updateQuantity(item.id, 1, item.quantity)}
                        disabled={isUpdating}
                        className="flex h-7 w-7 items-center justify-center rounded-full border transition-colors hover:bg-[var(--color-muted)]"
                        style={{ borderColor: 'var(--color-border)' }}
                        aria-label="Artir"
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                    </div>

                    <div className="flex items-center gap-3">
                      <span className="font-semibold" style={{ color: 'var(--color-primary)' }}>
                        TRY {formatPrice(lineTotal)}
                      </span>
                      <button
                        onClick={() => removeItem(item.id)}
                        disabled={isUpdating}
                        className="flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-[var(--color-muted)]"
                        style={{ color: 'var(--color-muted-fg)' }}
                        aria-label="Kaldir"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        <div className="h-fit rounded-xl border p-6" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
          <h2 className="mb-4 font-semibold" style={{ color: 'var(--color-primary)' }}>
            Siparis Ozeti
          </h2>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between" style={{ color: 'var(--color-muted-fg)' }}>
              <span>Ara toplam (KDV haric)</span>
              <span>TRY {formatPrice(netSubtotal)}</span>
            </div>
            {(cart.taxBreakdown ?? []).map((entry) => (
              <div key={entry.ratePercent} className="flex justify-between" style={{ color: 'var(--color-muted-fg)' }}>
                <span>KDV %{entry.ratePercent}</span>
                <span>TRY {formatPrice(entry.taxAmount)}</span>
              </div>
            ))}
            {couponDiscount > 0 ? (
              <div className="flex justify-between" style={{ color: 'var(--color-success)' }}>
                <span>Kupon indirimi</span>
                <span>-TRY {formatPrice(couponDiscount)}</span>
              </div>
            ) : null}
            <div className="flex justify-between" style={{ color: 'var(--color-muted-fg)' }}>
              <span>Kargo</span>
              <span>{shipping === 0 ? <span style={{ color: 'var(--color-success)' }}>Ucretsiz</span> : `TRY ${formatPrice(shipping)}`}</span>
            </div>
            {shipping > 0 ? (
              <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                TRY {freeShippingThreshold.toLocaleString('tr-TR')} uzeri ucretsiz kargo
              </p>
            ) : null}
            {cart.couponCode ? <p className="text-xs" style={{ color: 'var(--color-success)' }}>Kupon: {cart.couponCode}</p> : null}
            <CouponForm
              couponCode={cart.couponCode}
              onUpdated={async () => {
                await fetchCart()
                window.dispatchEvent(new CustomEvent('hanuja:cart-changed'))
              }}
            />
            <Separator />
            <div className="flex justify-between font-semibold text-base" style={{ color: 'var(--color-primary)' }}>
              <span>Toplam</span>
              <span>TRY {formatPrice(total)}</span>
            </div>
          </div>
          <Link href="/odeme">
            <Button data-testid="cart-checkout" className="mt-6 w-full" size="lg">
              Odemeye Gec
            </Button>
          </Link>
          <Link href="/">
            <Button variant="ghost" className="mt-2 w-full" size="sm">
              Alisverise Devam Et
            </Button>
          </Link>
        </div>
      </div>
    </div>
  )
}
