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
  /** Aggregate rating across approved reviews. Omit if no reviews exist. */
  aggregateRating?: { ratingValue: number; reviewCount: number }
}

export function buildProductStructuredData(input: ProductStructuredDataInput): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: input.name,
    description: input.description,
    url: absoluteCanonical.product(input.slug),
    ...(input.sku ? { sku: input.sku } : {}),
    ...(input.brand ? { brand: { '@type': 'Brand', name: input.brand } } : {}),
    ...(input.imageUrl ? { image: input.imageUrl } : {}),
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
              shippingRate: {
                '@type': 'MonetaryAmount',
                value: input.shippingRateTry,
                currency: 'TRY',
              },
            },
          }
        : {}),
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
