'use client'

import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { CircleCheck } from 'lucide-react'
import {
  CART_FADE_MS,
  CART_FLIGHT_MS,
  CART_TARGET_ATTRIBUTE,
  CART_TOAST_ENTER_MS,
  CART_TOAST_VISIBLE_MS,
  computeFlightDelta,
  prefersReducedMotion,
} from '@/lib/cart-flight'

interface Props {
  /** Called once the pill has been pulled into the header cart icon (or faded out). */
  onLanded: () => void
}

/**
 * One-shot "Sepete eklendi" confirmation: visible for a second, then pulled into the
 * header cart icon. Mount it with a new `key` to play it again.
 */
export function CartAddedFlyout({ onLanded }: Props) {
  const pillRef = useRef<HTMLDivElement>(null)
  const onLandedRef = useRef(onLanded)

  useEffect(() => {
    onLandedRef.current = onLanded
  }, [onLanded])

  useEffect(() => {
    const pill = pillRef.current
    if (!pill) return

    let cancelled = false
    const animations: Animation[] = []
    const land = () => {
      if (!cancelled) onLandedRef.current()
    }

    const reducedMotion = prefersReducedMotion()
    const canAnimate = typeof pill.animate === 'function'

    if (canAnimate && !reducedMotion) {
      animations.push(
        pill.animate(
          [
            { opacity: 0, transform: 'translateY(-8px)' },
            { opacity: 1, transform: 'translateY(0)' },
          ],
          { duration: CART_TOAST_ENTER_MS, easing: 'ease-out' },
        ),
      )
    }

    const timer = window.setTimeout(() => {
      if (!canAnimate) {
        land()
        return
      }

      const target = document.querySelector<HTMLElement>(`[${CART_TARGET_ATTRIBUTE}]`)
      const targetRect = target?.getBoundingClientRect()
      const exit =
        !reducedMotion && targetRect && targetRect.width > 0
          ? (() => {
              const { dx, dy } = computeFlightDelta(pill.getBoundingClientRect(), targetRect)
              return pill.animate(
                [
                  { opacity: 1, transform: 'translate(0, 0) scale(1)' },
                  { opacity: 0, transform: `translate(${dx}px, ${dy}px) scale(0.1)` },
                ],
                {
                  duration: CART_FLIGHT_MS,
                  easing: 'cubic-bezier(0.55, 0, 0.75, 0.2)',
                  fill: 'forwards',
                },
              )
            })()
          : pill.animate([{ opacity: 1 }, { opacity: 0 }], {
              duration: CART_FADE_MS,
              fill: 'forwards',
            })

      animations.push(exit)
      exit.onfinish = land
    }, CART_TOAST_ENTER_MS + CART_TOAST_VISIBLE_MS)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
      animations.forEach((animation) => animation.cancel())
    }
  }, [])

  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 top-3 z-[100] flex justify-center px-4">
      <div
        ref={pillRef}
        role="status"
        aria-live="polite"
        className="inline-flex items-center gap-1.5 rounded-full border border-success bg-white px-3 py-1.5 text-sm font-medium text-[#15803d] shadow-md"
      >
        <CircleCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
        Sepete eklendi
      </div>
    </div>,
    document.body,
  )
}
