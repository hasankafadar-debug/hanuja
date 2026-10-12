import { canSeeMessage } from '../domain/communication-audience'

type Message = { authorRole: string; audience?: string | null }
type Evidence = { uploadedBy: string | null }

/** Explicit boundary: internal inspection and historical shared content never reach customers. */
export function participantReturn<T extends {
  status: string
  reviewedAt?: Date | null
  sellerRejectedAt?: Date | null
  messages: Message[]
  evidence: Evidence[]
  items: Array<{ rejectionReason: string | null; rejectedQuantity: number }>
}>(rr: T, viewer: 'customer' | 'seller', userId?: string) {
  const safe = {
    ...rr,
    messages: rr.messages.filter((message) => canSeeMessage(viewer, message)),
    evidence: rr.evidence.filter((asset) => asset.uploadedBy === userId),
  }
  if (viewer === 'seller') return { ...safe, reason: 'Hanuja iade incelemesi', description: null, order: undefined }
  const reviewedAfterInspection = rr.reviewedAt && (!rr.sellerRejectedAt || rr.reviewedAt >= rr.sellerRejectedAt)
  const pendingReview = !reviewedAfterInspection && (rr.status === 'rejected' || rr.items.some((item) => item.rejectedQuantity > 0))
  return {
    ...safe,
    status: pendingReview ? 'under_review' : rr.status,
    sellerRejectReason: null,
    sellerRejectDescription: null,
    sellerRejectedAt: null,
    escalatedDispute: null,
    disputeId: null,
    order: undefined,
    items: rr.items.map((item) => ({ ...item, rejectionReason: null, rejectedQuantity: pendingReview ? 0 : item.rejectedQuantity })),
  }
}
