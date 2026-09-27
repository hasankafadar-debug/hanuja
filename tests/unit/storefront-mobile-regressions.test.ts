/**
 * Source guards for storefront issues found on a 402px phone (iPhone 16 Pro):
 * - the category dropdown was clipped inside an overflow wrapper (and its scrollbar
 *   shifted the menu left on desktop hover);
 * - the large header logo overflowed phones between 400px and 440px wide, pushing
 *   the cart badge off screen;
 * - the orders list shipped every order's contract HTML with the page;
 * - the add-to-cart confirmation is the fly-to-cart pill, not a two-line toast.
 */
import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

function source(path: string) {
  return readFile(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8')
}

describe('storefront category menu', () => {
  it('does not wrap the mega menu in an overflow container', async () => {
    const nav = await source('apps/web/src/components/storefront/storefront-nav.tsx')

    expect(nav).toContain('<MegaMenu')
    expect(nav).not.toMatch(/className="[^"]*overflow-x-auto/)
  })

  it('opens the panel on hover only for a real mouse and toggles it on touch', async () => {
    const menu = await source('packages/ui/src/components/nav/mega-menu.tsx')

    expect(menu).not.toContain('onMouseEnter')
    expect(menu).toContain("e.pointerType !== 'mouse'")
    expect(menu).toContain("lastPointerType.current === 'touch'")
    expect(menu).toContain('Tüm {activeItem.label} ürünleri')
    expect(menu).not.toContain('repeat(')
  })
})

describe('storefront header', () => {
  it('switches to the large logo only where it fits', async () => {
    const layout = await source('apps/web/src/app/(storefront)/layout.tsx')

    expect(layout).not.toContain('min-[400px]')
    expect(layout).toContain('min-[440px]:hidden')
    expect(layout).toContain('hidden min-[440px]:inline-flex')
  })
})

describe('orders list', () => {
  it('loads contract documents only when a dialog is opened', async () => {
    const page = await source('apps/web/src/app/(storefront)/(account)/siparis/page.tsx')

    expect(page).not.toMatch(/\shtml=\{/)
    expect(page).toContain('/documents/contracts/distance-sales?goruntule=1')
    expect(page).toContain('/documents/contracts/pre-information?goruntule=1')
  })
})

describe('add to cart confirmation', () => {
  it('uses the fly-to-cart pill without the second line', async () => {
    const button = await source('apps/web/src/app/(storefront)/urun/[slug]/add-to-cart-button.tsx')

    expect(button).toContain('<CartAddedFlyout')
    expect(button).not.toContain('Ürün sepetinize eklendi')
    expect(button).not.toContain("title: 'Sepete eklendi'")
  })
})
