import { ValidationError } from './errors'

export type ContractKind = 'distance-sales' | 'pre-information'

export function parseContractKind(value: string): ContractKind {
  if (value === 'distance-sales' || value === 'pre-information') {
    return value
  }

  throw new ValidationError('Geçersiz sözleşme türü.')
}

export function getContractFileName(orderId: string, kind: string) {
  const normalizedKind = parseContractKind(kind)
  const shortId = orderId.slice(-8).toUpperCase()

  if (normalizedKind === 'distance-sales') {
    return `siparis-${shortId}-mesafeli-satis-sozlesmesi.html`
  }

  return `siparis-${shortId}-on-bilgilendirme-formu.html`
}

export function getContractHtml(
  snapshot: {
    distanceSalesHtml: string
    preInformationHtml: string
  },
  kind: string,
) {
  const normalizedKind = parseContractKind(kind)
  return normalizedKind === 'distance-sales'
    ? snapshot.distanceSalesHtml
    : snapshot.preInformationHtml
}
