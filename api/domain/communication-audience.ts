export type CommunicationAudience = 'customer' | 'seller' | 'internal'

/** Old messages have no audience and are retained for staff only. */
export function canSeeMessage(viewer: 'customer' | 'seller', message: {
  authorRole: string
  audience?: string | null
}): boolean {
  if (message.audience !== viewer) return false
  return message.authorRole === viewer || message.authorRole === 'admin'
}

export function messageAudience(authorRole: string, target?: CommunicationAudience): CommunicationAudience {
  if (authorRole === 'customer') return 'customer'
  if (authorRole === 'seller') return 'seller'
  return target ?? 'internal'
}

/** Preliminary cargo approval is not a final decision on a later designer rejection. */
export function isPendingReturnInspection(request: {
  disputeId?: string | null
  reviewedAt?: Date | null
  sellerRejectedAt?: Date | null
}) {
  return Boolean(request.disputeId && (!request.reviewedAt ||
    (request.sellerRejectedAt && request.sellerRejectedAt > request.reviewedAt)))
}
