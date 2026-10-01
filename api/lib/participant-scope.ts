import type { Prisma } from '@prisma/client'

/** A return assigned to seller A is never shared with seller B on the order. */
export function returnParticipantScope(userId: string, sellerId: string | null): Prisma.ReturnRequestWhereInput {
  return {
    OR: [
      { customerId: userId },
      ...(sellerId ? [
        { sellerId },
        { sellerId: null, order: { lines: { some: { sellerId } } } },
      ] : []),
    ],
  }
}

export function disputeParticipantScope(userId: string, sellerId: string | null): Prisma.DisputeWhereInput {
  return {
    OR: [
      { order: { customerId: userId } },
      ...(sellerId ? [{
        order: { lines: { some: { sellerId } } },
        OR: [
          { escalatedFromReturn: { is: null } },
          { escalatedFromReturn: { is: { OR: [{ sellerId }, { sellerId: null }] } } },
        ],
      }] : []),
    ],
  }
}
