/**
 * The legal snapshot is immutable evidence of what the buyer accepted. This
 * projection is only for seller delivery: it must never be written back to
 * the snapshot or used for hash verification.
 */
export interface SellerLegalSnapshot {
  distanceSalesHtml: string
  preInformationHtml: string
}

const buyerEmailFieldPattern = /(<p>\s*<strong>\s*E-posta:\s*<\/strong>)[\s\S]*?(<\/p>)/gi

function redactBuyerEmail(html: string) {
  return html.replace(buyerEmailFieldPattern, '$1 Gizlendi$2')
}

/**
 * Produces the seller-safe contract view while preserving operational buyer
 * phone and address details required for fulfilment.
 */
export function toSellerSafeLegalSnapshot(snapshot: SellerLegalSnapshot): SellerLegalSnapshot {
  return {
    distanceSalesHtml: redactBuyerEmail(snapshot.distanceSalesHtml),
    preInformationHtml: redactBuyerEmail(snapshot.preInformationHtml),
  }
}
