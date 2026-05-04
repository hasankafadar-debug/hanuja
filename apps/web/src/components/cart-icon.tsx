'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ShoppingCart } from 'lucide-react'

type CartCountResponse = {
  data?: {
    count: number
  }
}

export default function CartIcon() {
  const [count, setCount] = useState(0)

  const loadCount = useCallback(async () => {
    try {
      const res = await fetch('/api/cart/count', { cache: 'no-store' })
      if (!res.ok) {
        setCount(0)
        return
      }

      const body = (await res.json()) as CartCountResponse
      setCount(body.data?.count ?? 0)
    } catch {
      setCount(0)
    }
  }, [])

  useEffect(() => {
    void loadCount()

    const handleCartChanged = () => {
      void loadCount()
    }

    window.addEventListener('hanuja:cart-changed', handleCartChanged)
    return () => window.removeEventListener('hanuja:cart-changed', handleCartChanged)
  }, [loadCount])

  return (
    <Link
      href="/sepet"
      className="relative flex h-9 w-9 items-center justify-center rounded-full transition-colors hover:bg-[var(--color-muted)]"
      aria-label={count > 0 ? `Sepet (${count} ürün)` : 'Sepet'}
    >
      <ShoppingCart className="h-5 w-5" style={{ color: 'var(--color-primary)' }} />
      {count > 0 ? (
        <span
          aria-label={`${count} ürün`}
          className="absolute -right-1 -top-1 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full px-1 text-[10px] font-semibold leading-none text-white"
          style={{ backgroundColor: 'var(--color-accent)' }}
        >
          {count > 99 ? '99+' : count}
        </span>
      ) : null}
    </Link>
  )
}
