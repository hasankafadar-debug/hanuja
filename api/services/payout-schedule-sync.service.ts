import type { PrismaClient } from '@prisma/client'

/** Post-commit recovery is also covered by the maturity worker. Never move money here. */
export async function syncChangedPayoutSchedules(
  prisma: PrismaClient,
  scope: { orderId?: string; sellerId?: string | null | undefined },
) {
  if (!scope.orderId && !scope.sellerId) return
  try {
    const targets = await prisma.payout.findMany({
      where: {
        ...(scope.orderId ? { orderId: scope.orderId } : {}),
        ...(scope.sellerId ? { sellerId: scope.sellerId } : {}),
        status: { notIn: ['payout_paid', 'payout_offset'] },
      },
      select: { id: true },
    })
    const { createPayoutService } = await import('./payout.service')
    const service = createPayoutService({ prisma })
    for (const target of targets) await service.reevaluate(target.id)
  } catch (error) {
    console.error('[payout-schedule] Post-commit refresh deferred', { ...scope, error })
  }
}
