import { describe, expect, it } from 'vitest'
import {
  CART_FLIGHT_MS,
  CART_TOAST_VISIBLE_MS,
  computeFlightDelta,
  prefersReducedMotion,
} from '../../apps/web/src/lib/cart-flight'

/**
 * The add-to-cart confirmation stays for one second, then flies from its own
 * centre into the centre of the header cart icon.
 */
describe('cart flight', () => {
  it('keeps the confirmation visible for one second before it flies', () => {
    expect(CART_TOAST_VISIBLE_MS).toBe(1000)
    expect(CART_FLIGHT_MS).toBeGreaterThan(0)
  })

  it('moves the pill centre onto the cart icon centre', () => {
    // Pill centred at the top of a 402px phone, cart icon at the right of the header.
    const pill = { left: 136, top: 12, width: 130, height: 32 }
    const cart = { left: 350, top: 14, width: 36, height: 36 }

    expect(computeFlightDelta(pill, cart)).toEqual({ dx: 167, dy: 4 })
  })

  it('returns a negative offset when the target is up and to the left', () => {
    const from = { left: 500, top: 600, width: 100, height: 40 }
    const to = { left: 20, top: 10, width: 20, height: 20 }

    expect(computeFlightDelta(from, to)).toEqual({ dx: -520, dy: -600 })
  })

  it('reports no reduced-motion preference outside the browser', () => {
    expect(prefersReducedMotion()).toBe(false)
  })
})
