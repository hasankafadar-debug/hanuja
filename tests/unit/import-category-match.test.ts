import { describe, expect, it } from 'vitest'
import { findSuggestedCategoryId } from '../../apps/seller-panel/src/lib/import-category-match'

const categories = [
  { id: 'ev-aydinlatma-tavan', name: 'Ev / Aydınlatma / Tavan & Sarkıt' },
  { id: 'ev-mobilya-sehpa', name: 'Ev / Mobilya / Sehpa Modelleri' },
  { id: 'ofis-mobilya-sehpa', name: 'Ofis / Mobilya / Sehpa Modelleri' },
  { id: 'ev-tekstil-yastik', name: 'Ev / Tekstil / Yastık' },
]

describe('Hipicon import category matching', () => {
  it('matches Turkish characters and leaf category names', () => {
    expect(findSuggestedCategoryId('Tavan Sarkit', categories)).toBe('ev-aydinlatma-tavan')
    expect(findSuggestedCategoryId('Yastik', categories)).toBe('ev-tekstil-yastik')
  })

  it('matches full category paths safely', () => {
    expect(findSuggestedCategoryId('Ev / Mobilya / Sehpa Modelleri', categories)).toBe('ev-mobilya-sehpa')
  })

  it('returns empty when the category match is ambiguous', () => {
    expect(findSuggestedCategoryId('Sehpa Modelleri', categories)).toBe('')
  })
})
