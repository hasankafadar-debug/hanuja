import { absoluteCanonical, getBaseUrl } from '../canonical-builder'

export interface ProductStructuredDataInput {
  name: string
  description: string
  slug: string
  price: number
  currencyCode?: string
  availability?: 'InStock' | 'OutOfStock' | 'PreOrder'
  brand?: string
  imageUrl?: string
  sku?: string
  shippingRateTry?: number
  shippingDeliveryTime?: { handlingDays: number; transitMinDays: number; transitMaxDays: number }
  /** Aggregate rating across approved reviews. Omit if no reviews exist. */
  aggregateRating?: { ratingValue: number; reviewCount: number }
  /** Approved reviews displayed on this page; authorName must match the public display name. */
  reviews?: Array<{
    authorName: string
    rating: number
    title?: string | null
    body: string
    datePublished: string
  }>
}

function buildDeliveryTime(input: ProductStructuredDataInput['shippingDeliveryTime']) {
  if (
    !input ||
    ![input.handlingDays, input.transitMinDays, input.transitMaxDays].every(
      (days) => Number.isInteger(days) && days >= 0,
    ) ||
    input.transitMinDays > input.transitMaxDays
  ) return undefined

  return {
    '@type': 'ShippingDeliveryTime',
    businessDays: {
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].map(
        (day) => 'https://schema.org/' + day,
      ),
    },
    handlingTime: {
      '@type': 'QuantitativeValue',
      minValue: 0,
      maxValue: input.handlingDays,
      unitCode: 'DAY',
    },
    transitTime: {
      '@type': 'QuantitativeValue',
      minValue: input.transitMinDays,
      maxValue: input.transitMaxDays,
      unitCode: 'DAY',
    },
  }
}

export function buildProductStructuredData(input: ProductStructuredDataInput): object {
  const deliveryTime = buildDeliveryTime(input.shippingDeliveryTime)
  const reviews = (input.reviews ?? [])
    .filter((review) => {
      const author = review.authorName.trim()
      return (
        author.length > 0 &&
        author.length < 100 &&
        author !== '-' &&
        Number.isInteger(review.rating) &&
        review.rating >= 1 &&
        review.rating <= 5 &&
        review.body.trim().length > 0
      )
    })
    .map((review) => ({
      '@type': 'Review',
      author: { '@type': 'Person', name: review.authorName.trim() },
      reviewRating: {
        '@type': 'Rating',
        ratingValue: review.rating,
        bestRating: 5,
        worstRating: 1,
      },
      ...(review.title?.trim() ? { name: review.title.trim() } : {}),
      reviewBody: review.body.trim(),
      ...(Number.isFinite(Date.parse(review.datePublished))
        ? { datePublished: review.datePublished }
        : {}),
    }))
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: input.name,
    description: input.description,
    url: absoluteCanonical.product(input.slug),
    ...(input.sku ? { sku: input.sku } : {}),
    ...(input.brand ? { brand: { '@type': 'Brand', name: input.brand } } : {}),
    ...(input.imageUrl ? { image: input.imageUrl } : {}),
    ...(reviews.length > 0 ? { review: reviews } : {}),
    ...(input.aggregateRating && input.aggregateRating.reviewCount > 0
      ? {
          aggregateRating: {
            '@type': 'AggregateRating',
            ratingValue: input.aggregateRating.ratingValue.toFixed(1),
            reviewCount: input.aggregateRating.reviewCount,
            bestRating: '5',
            worstRating: '1',
          },
        }
      : {}),
    offers: {
      '@type': 'Offer',
      priceCurrency: input.currencyCode ?? 'TRY',
      price: input.price.toFixed(2),
      availability: `https://schema.org/${input.availability ?? 'InStock'}`,
      url: absoluteCanonical.product(input.slug),
      ...(input.shippingRateTry !== undefined
        ? {
            shippingDetails: {
              '@type': 'OfferShippingDetails',
              shippingDestination: { '@type': 'DefinedRegion', addressCountry: 'TR' },
              ...(deliveryTime ? { deliveryTime } : {}),
              shippingRate: {
                '@type': 'MonetaryAmount',
                value: input.shippingRateTry,
                currency: 'TRY',
              },
            },
          }
        : {}),
      // Reference the published organization policy without overriding its exceptions.
      hasMerchantReturnPolicy: { '@id': getBaseUrl() + '/iade-iptal#return-policy' },
      seller: {
        '@type': 'Organization',
        '@id': getBaseUrl() + '/#organization',
        name: 'Hanuja',
        url: getBaseUrl(),
      },
    },
  }
}

/** Accept real gallery assets only; private API proxies cannot be crawled by Google. */
export function selectProductSchemaImageUrl(images: string[]): string | undefined {
  for (const image of images) {
    if (
      !image.trim() ||
      (!image.startsWith('/') &&
        !image.toLowerCase().startsWith('https://') &&
        !image.toLowerCase().startsWith('http://'))
    )
      continue
    try {
      const url = new URL(image, getBaseUrl())
      if (
        ['https:', 'http:'].includes(url.protocol) &&
        !url.username &&
        !url.password &&
        !url.pathname.startsWith('/api/')
      )
        return url.href
    } catch {
      /* Try the next real gallery image. */
    }
  }
  return undefined
}
