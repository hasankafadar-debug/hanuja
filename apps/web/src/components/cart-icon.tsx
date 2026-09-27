'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ShoppingCart } from 'lucide-react'
import {
  CART_BADGE_POP_MS,
  CART_CHANGED_EVENT,
  CART_ICON_BUMP_MS,
  prefersReducedMotion,
  type CartChangedDetail,
} from '@/lib/cart-flight'

type CartCountResponse = {
  data?: {
    count: number
  }
}

export default function CartIcon() {
  const [count, setCount] = useState(0)
  // Bumped after an add-to-cart confirmation lands; replays the icon/badge animation.
  const [landingCount, setLandingCount] = useState(0)
  const iconRef = useRef<SVGSVGElement>(null)
  const badgeRef = useRef<HTMLSpanElement>(null)

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

    const handleCartChanged = (event: Event) => {
      const reason = (event as CustomEvent<CartChangedDetail | null>).detail?.reason
      void loadCount().then(() => {
        if (reason === 'added') setLandingCount((value) => value + 1)
      })
    }

    window.addEventListener(CART_CHANGED_EVENT, handleCartChanged)
    return () => window.removeEventListener(CART_CHANGED_EVENT, handleCartChanged)
  }, [loadCount])

  useEffect(() => {
    if (landingCount === 0 || prefersReducedMotion()) return

    iconRef.current?.animate?.(
      [{ transform: 'scale(1)' }, { transform: 'scale(1.18)' }, { transform: 'scale(1)' }],
      { duration: CART_ICON_BUMP_MS, easing: 'ease-out' },
    )
    badgeRef.current?.animate?.(
      [{ transform: 'scale(0)' }, { transform: 'scale(1.35)' }, { transform: 'scale(1)' }],
      { duration: CART_BADGE_POP_MS, easing: 'ease-out' },
    )
  }, [landingCount])

  return (
    <Link
      href="/sepet"
      data-cart-target=""
      className="relative flex h-9 w-9 items-center justify-center rounded-full transition-colors hover:bg-[var(--color-muted)]"
      aria-label={count > 0 ? `Sepet (${count} ürün)` : 'Sepet'}
    >
      <ShoppingCart ref={iconRef} className="h-5 w-5" style={{ color: 'var(--color-primary)' }} />
      {count > 0 ? (
        <span
          ref={badgeRef}
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
