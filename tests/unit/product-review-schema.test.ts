import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import * as React from 'react'
import { toProductSchemaReviews } from '../../apps/web/src/lib/product-review-schema'
import { buildProductStructuredData } from '../../packages/seo/src/structured-data/product'
import { JsonLd } from '../../packages/seo/src/json-ld'
import { createProductReviewRepository } from '../../api/repositories/product-review.repository'
import { ReviewList } from '../../apps/web/src/app/(storefront)/urun/[slug]/_components/review-list'

const product = { name: 'Mosaiss Antico', description: 'Sehpa', slug: 'antico', price: 1500 }
const approved = {
  id: 'review-1',
  status: 'approved',
  rating: 4,
  title: 'Beklediğim gibi',
  body: 'Ürünün malzemesini ve işçiliğini beğendim.',
  createdAt: new Date('2026-10-19T08:30:00.000Z'),
  customer: { name: 'Ayşe Nur Yılmaz' },
}
const schema = (reviews = [approved]) => buildProductStructuredData({
  ...product,
  reviews: toProductSchemaReviews(reviews),
}) as any

beforeEach(() => vi.stubGlobal('React', React))
afterEach(() => vi.unstubAllGlobals())

describe('public product review JSON-LD', () => {
  it('omits review and aggregateRating until real approved feedback exists', () => {
    const data = schema([])
    expect(data).not.toHaveProperty('review')
    expect(data).not.toHaveProperty('aggregateRating')
    expect(data.offers).toMatchObject({ '@type': 'Offer', price: '1500.00' })
  })

  it('includes the displayed comment, rating, date and masked author without exposing full identity', () => {
    const data = schema()
    expect(data.review).toEqual([{
      '@type': 'Review',
      author: { '@type': 'Person', name: 'Ayşe Y.' },
      reviewRating: { '@type': 'Rating', ratingValue: 4, bestRating: 5, worstRating: 1 },
      name: approved.title,
      reviewBody: approved.body,
      datePublished: '2026-10-19T08:30:00.000Z',
    }])
    expect(JSON.stringify(data)).not.toContain('Yılmaz')
    expect(JSON.stringify(data)).not.toContain('Ayşe Nur')
    expect(approved.customer.name).toBe('Ayşe Nur Yılmaz')
    const visibleHtml = renderToStaticMarkup(createElement(ReviewList, { reviews: [approved], total: 1 }))
    expect(visibleHtml).toContain(data.review[0].author.name)
    expect(visibleHtml).toContain(data.review[0].reviewBody)
    expect(visibleHtml).toContain('4 / 5 yıldız')
  })

  it('uses only the approved public query, excluding pending and rejected comments', async () => {
    const rows = [
      approved,
      { ...approved, id: 'pending', status: 'pending_moderation', body: 'Bekleyen yorum' },
      { ...approved, id: 'rejected', status: 'rejected', body: 'Reddedilen yorum' },
    ]
    const findMany = vi.fn(async ({ where }) => rows.filter((row) => row.status === where.status))
    const repository = createProductReviewRepository({ productReview: { findMany } } as never)
    const visible = await repository.listApprovedForProduct({ productId: 'product-1', take: 20 })
    const data = schema(visible as typeof approved[])
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { productId: 'product-1', status: 'approved' }, take: 20,
    }))
    expect(data.review).toHaveLength(1)
    expect(JSON.stringify(data)).not.toMatch(/Bekleyen yorum|Reddedilen yorum/)
  })

  it('preserves the aggregate across all approved reviews when the displayed list is paginated', () => {
    const data = buildProductStructuredData({
      ...product,
      aggregateRating: { ratingValue: 4.6, reviewCount: 25 },
      reviews: toProductSchemaReviews([approved, { ...approved, rating: 5, title: null }]),
    }) as any
    expect(data.aggregateRating).toMatchObject({ ratingValue: '4.6', reviewCount: 25 })
    expect(data.review).toHaveLength(2)
    expect(data.review[1]).not.toHaveProperty('name')
  })

  it.each([0, 6, 2.5, NaN, Infinity])('omits invalid ratings instead of inventing a score: %s', (rating) => {
    expect(schema([{ ...approved, rating }])).not.toHaveProperty('review')
  })

  it('omits nameless authors and empty comments instead of publishing placeholder reviews', () => {
    expect(schema([{ ...approved, customer: { name: '   ' } }])).not.toHaveProperty('review')
    expect(schema([{ ...approved, body: '   ' }])).not.toHaveProperty('review')
    expect(schema([{ ...approved, customer: { name: 'A'.repeat(100) } }])).not.toHaveProperty('review')
  })

  it('keeps customer text as JSON data without allowing it to close the script element', () => {
    const body = 'Yorum </script><script>alert("x")</script> & ürün'
    const data = schema([{ ...approved, body }])
    const html = renderToStaticMarkup(createElement(JsonLd, { data }))
    expect(html.match(/<script/g)).toHaveLength(1)
    expect(html).not.toContain('</script><script>')
    const json = html.slice(html.indexOf('>') + 1, html.lastIndexOf('</script>'))
    expect(JSON.parse(json).review[0].reviewBody).toBe(body)
  })
})
