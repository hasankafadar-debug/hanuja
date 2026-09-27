/**
 * Timing and geometry for the add-to-cart confirmation that is pulled into the
 * header cart icon before the badge count appears.
 */

export const CART_TOAST_ENTER_MS = 150
export const CART_TOAST_VISIBLE_MS = 1000
export const CART_FLIGHT_MS = 450
export const CART_FADE_MS = 150
export const CART_ICON_BUMP_MS = 250
export const CART_BADGE_POP_MS = 350

/** Header cart icon refetches its count on this event; `reason: 'added'` also animates the badge. */
export const CART_CHANGED_EVENT = 'hanuja:cart-changed'

export type CartChangedDetail = { reason?: 'added' }

/** Marks the header element the confirmation flies into (set on the cart icon link). */
export const CART_TARGET_ATTRIBUTE = 'data-cart-target'

type RectLike = { left: number; top: number; width: number; height: number }

/** Offset that moves the centre of `from` onto the centre of `to`. */
export function computeFlightDelta(from: RectLike, to: RectLike): { dx: number; dy: number } {
  return {
    dx: to.left + to.width / 2 - (from.left + from.width / 2),
    dy: to.top + to.height / 2 - (from.top + from.height / 2),
  }
}

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}
