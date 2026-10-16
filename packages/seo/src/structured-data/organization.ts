import { getBaseUrl } from '../canonical-builder'

export interface OrganizationStructuredDataInput {
  legalName?: string
  email?: string
  telephone?: string
  address?: string
  sameAs?: string[]
}

export function buildOrganizationStructuredData(
  input: OrganizationStructuredDataInput = {},
): object {
  const baseUrl = getBaseUrl()
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': `${baseUrl}/#organization`,
    name: 'Hanuja',
    url: baseUrl,
    logo: `${baseUrl}/logo.svg`,
    ...(input.legalName ? { legalName: input.legalName } : {}),
    ...(input.email ? { email: input.email } : {}),
    ...(input.telephone ? { telephone: input.telephone } : {}),
    ...(input.address ? { address: input.address } : {}),
    ...(input.sameAs?.length ? { sameAs: input.sameAs } : {}),
    contactPoint: {
      '@type': 'ContactPoint',
      contactType: 'customer service',
      availableLanguage: 'Turkish',
      ...(input.email ? { email: input.email } : {}),
      ...(input.telephone ? { telephone: input.telephone } : {}),
    },
  }
}

export function buildWebsiteStructuredData(): object {
  const baseUrl = getBaseUrl()
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': `${baseUrl}/#website`,
    name: 'Hanuja',
    url: `${baseUrl}/`,
    inLanguage: 'tr-TR',
    publisher: { '@id': `${baseUrl}/#organization` },
  }
}
