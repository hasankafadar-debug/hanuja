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
    offers: {
      '@type': 'Offer',
      priceCurrency: input.currencyCode ?? 'TRY',
      price: input.price.toFixed(2),
      availability: `https://schema.org/${input.availability ?? 'InStock'}`,
      url: absoluteCanonical.product(input.slug),
      seller: {
        '@type': 'Organization',
        name: 'Hanuja',
        url: getBaseUrl(),
      },
    },
  }
}
