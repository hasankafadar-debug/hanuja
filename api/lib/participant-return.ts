import { canSeeMessage } from '../domain/communication-audience'

type Message = { authorRole: string; audience?: string | null }
type Evidence = { uploadedBy: string | null }

/** Shared boundary for the server-rendered seller list and API. */
export function sellerReturnListItem<T extends object>(rr: T) {
  return {
    ...rr,
    reason: 'Hanuja iade incelemesi',
    description: null,
    reviewNote: null,
  }
}

/** Explicit boundary: internal inspection and historical shared content never reach customers. */
export function participantReturn<
  T extends {
    status: string
    reviewedAt?: Date | null
    sellerRejectedAt?: Date | null
    escalatedDispute?: { status: string } | null
    messages: Message[]
    evidence: Evidence[]
    items: Array<{
      rejectionReason: string | null
      rejectedQuantity: number
      acceptedQuantity?: number
      requestedQuantity?: number
    }>
  },
>(rr: T, viewer: 'customer' | 'seller', userId?: string) {
  const safe = {
    ...rr,
    messages: rr.messages.filter((message) => canSeeMessage(viewer, message)),
    evidence: rr.evidence.filter((asset) => asset.uploadedBy === userId),
  }
  if (viewer === 'seller') return { ...sellerReturnListItem(safe), order: undefined }
  const reviewedAfterInspection =
    rr.reviewedAt && (!rr.sellerRejectedAt || rr.reviewedAt >= rr.sellerRejectedAt)
  const pendingReview =
    !reviewedAfterInspection &&
    (rr.status === 'rejected' || rr.items.some((item) => item.rejectedQuantity > 0))
  const finalAccepted = Boolean(
    reviewedAfterInspection && rr.escalatedDispute?.status === 'resolved_for_customer',
  )
  return {
    ...safe,
    status: pendingReview ? 'under_review' : rr.status,
    sellerRejectReason: null,
    sellerRejectDescription: null,
    sellerRejectedAt: null,
    escalatedDispute: null,
    disputeId: null,
    order: undefined,
    items: rr.items.map((item) => ({
      ...item,
      rejectionReason: null,
      ...(finalAccepted && item.requestedQuantity !== undefined
        ? { acceptedQuantity: item.requestedQuantity }
        : {}),
      rejectedQuantity: pendingReview || finalAccepted ? 0 : item.rejectedQuantity,
    })),
  }
}
