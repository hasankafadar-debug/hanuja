import { absoluteCanonical } from '../canonical-builder'

export interface LocalBusinessStructuredDataInput {
  name: string
  slug: string
  description?: string
  imageUrl?: string
  city?: string
}

export function buildLocalBusinessStructuredData(
  input: LocalBusinessStructuredDataInput,
): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'Store',
    name: input.name,
    url: absoluteCanonical.store(input.slug),
    ...(input.description ? { description: input.description } : {}),
    ...(input.imageUrl ? { image: input.imageUrl } : {}),
    ...(input.city
      ? { address: { '@type': 'PostalAddress', addressLocality: input.city, addressCountry: 'TR' } }
      : {}),
  }
}
