import { describe, expect, it } from 'vitest'
import {
  buildStorefrontMenuItems,
  type FlatCategory,
} from '../../apps/web/src/lib/storefront-nav-menu'
import { STOREFRONT_NAV_ITEMS } from '../../apps/web/src/config/storefront-nav'

/**
 * The header menu only shows category branches that contain a published product
 * (launch policy) and shows them again as soon as one is published. The input is
 * the customer-visible tree from `listCustomerVisibleCategories`, which already
 * leaves out empty branches.
 */
const ev: FlatCategory = { id: 'ev', parentId: null, slug: 'ev', name: 'Ev' }
const evMobilya: FlatCategory = { id: 'ev-mobilya', parentId: 'ev', slug: 'ev-mobilya', name: 'Mobilya' }
const sehpa: FlatCategory = {
  id: 'sehpa',
  parentId: 'ev-mobilya',
  slug: 'ev-mobilya-sehpa-modelleri',
  name: 'Sehpa Modelleri',
}
const evDekorasyon: FlatCategory = {
  id: 'ev-dekorasyon',
  parentId: 'ev',
  slug: 'ev-dekorasyon',
  name: 'Dekorasyon',
}
const vazo: FlatCategory = {
  id: 'vazo',
  parentId: 'ev-dekorasyon',
  slug: 'ev-dekorasyon-vazo',
  name: 'Vazo',
}
const ofis: FlatCategory = { id: 'ofis', parentId: null, slug: 'ofis', name: 'Ofis' }
const ofisMobilya: FlatCategory = {
  id: 'ofis-mobilya',
  parentId: 'ofis',
  slug: 'ofis-mobilya',
  name: 'Ofis Mobilyası',
}
const calismaMasasi: FlatCategory = {
  id: 'calisma-masasi',
  parentId: 'ofis-mobilya',
  slug: 'ofis-mobilya-calisma-masasi',
  name: 'Çalışma Masası',
}

function labels(categories: FlatCategory[], loadFailed = false) {
  return buildStorefrontMenuItems(categories, loadFailed).map((item) => item.label)
}

describe('storefront header menu visibility', () => {
  it('shows only branches with published products', () => {
    expect(labels([ev, evMobilya, sehpa])).toEqual(['Ev', 'Mobilya', 'İndirim'])
  })

  it('shows a branch again once a product is published in it', () => {
    expect(labels([ev, evMobilya, sehpa])).not.toContain('Dekorasyon')
    expect(labels([ev, evMobilya, sehpa, evDekorasyon, vazo])).toEqual([
      'Ev',
      'Mobilya',
      'Dekorasyon',
      'İndirim',
    ])
  })

  it('shows a virtual collection when either its home or its office branch is visible', () => {
    expect(labels([ofis, ofisMobilya, calismaMasasi])).toEqual(['Ofis', 'Mobilya', 'İndirim'])
  })

  it('lists only visible sub-categories in the dropdown', () => {
    const mobilya = buildStorefrontMenuItems([ev, evMobilya, sehpa], false).find(
      (item) => item.label === 'Mobilya',
    )

    expect(mobilya?.columns).toEqual([
      {
        header: 'EV MOBİLYASI',
        href: '/kategori/ev/ev-mobilya',
        items: [{ label: 'Sehpa Modelleri', href: '/kategori/ev/ev-mobilya/ev-mobilya-sehpa-modelleri' }],
      },
    ])
  })

  it('shows only the discount link when nothing is published yet', () => {
    expect(labels([])).toEqual(['İndirim'])
  })

  it('falls back to the full menu when the category query fails', () => {
    expect(labels([], true)).toEqual(STOREFRONT_NAV_ITEMS.map((item) => item.label))
  })
})
