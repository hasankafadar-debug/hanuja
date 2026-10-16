import { absoluteCanonical } from '../canonical-builder'

export interface DesignerStructuredDataInput {
  name: string
  slug: string
  description?: string
  imageUrl?: string
}

/** A supplier's design profile, not a separate retail seller or physical shop. */
export function buildDesignerStructuredData(input: DesignerStructuredDataInput): object {
  const url = absoluteCanonical.store(input.slug)
  return {
    '@context': 'https://schema.org',
    '@type': 'ProfilePage',
    '@id': url,
    url,
    name: `${input.name} Tasarımları`,
    inLanguage: 'tr-TR',
    mainEntity: {
      '@type': 'Organization',
      '@id': `${url}#designer`,
      name: input.name,
      url,
      ...(input.description ? { description: input.description } : {}),
      ...(input.imageUrl ? { image: input.imageUrl } : {}),
    },
  }
}
