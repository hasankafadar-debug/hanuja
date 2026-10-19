import { maskCustomerName } from '@hanuja/security'
import type { ProductStructuredDataInput } from '@hanuja/seo'

interface PublicProductReview {
  rating: number
  title: string | null
  body: string
  createdAt: Date
  customer: { name: string | null }
}

/** Map the same approved reviews shown by ReviewList, preserving its author privacy. */
export function toProductSchemaReviews(
  reviews: PublicProductReview[],
): NonNullable<ProductStructuredDataInput['reviews']> {
  return reviews.map((review) => ({
    authorName: maskCustomerName(review.customer.name),
    rating: review.rating,
    title: review.title,
    body: review.body,
    datePublished: review.createdAt.toISOString(),
  }))
}
