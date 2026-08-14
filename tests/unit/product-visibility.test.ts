import { describe, expect, it } from 'vitest'
import {
  PUBLIC_PRODUCT_WHERE,
  buildPublicProductWhere,
} from '../../api/domain/product-visibility'

describe('public product visibility', () => {
  it('requires a published product, an active seller, and Tatil Modu to be off', () => {
    expect(PUBLIC_PRODUCT_WHERE).toEqual({
      status: 'published',
      seller: { is: { status: 'active', vacationModeEnabled: false } },
    })
  })

  it('combines caller filters without weakening the public predicate', () => {
    expect(buildPublicProductWhere({ categoryId: 'category-1' })).toEqual({
      AND: [
        PUBLIC_PRODUCT_WHERE,
        { categoryId: 'category-1' },
      ],
    })
  })
})
