import { describe, expect, it } from 'vitest'
import {
  PUBLIC_PRODUCT_WHERE,
  buildPublicProductWhere,
} from '../../api/domain/product-visibility'

describe('public product visibility', () => {
  it('requires both a published product and an active seller', () => {
    expect(PUBLIC_PRODUCT_WHERE).toEqual({
      status: 'published',
      seller: { is: { status: 'active' } },
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
