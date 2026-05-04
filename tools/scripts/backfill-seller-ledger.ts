import { Decimal } from '@prisma/client/runtime/client'
import prisma from '../../api/lib/prisma'
import { createSellerLedgerRepository } from '../../api/repositories/seller-ledger.repository'

async function main() {
  const ledger = createSellerLedgerRepository(prisma)
  const payouts = await prisma.payout.findMany({
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  })

  for (const payout of payouts) {
    const saleEntry = await ledger.findByReference({
      sellerId: payout.sellerId,
      type: 'sale',
      referenceType: 'order',
      referenceId: payout.orderId,
    })
    if (!saleEntry) {
      await ledger.createEntry({
        sellerId: payout.sellerId,
        type: 'sale',
        amount: payout.grossAmount as unknown as Decimal,
        referenceType: 'order',
        referenceId: payout.orderId,
        description: 'Brut satis',
      })
    }

    const commissionEntry = await ledger.findByReference({
      sellerId: payout.sellerId,
      type: 'commission',
      referenceType: 'payout',
      referenceId: payout.id,
    })
    if (!commissionEntry && payout.commissionAmount.gt(0)) {
      await ledger.createEntry({
        sellerId: payout.sellerId,
        type: 'commission',
        amount: payout.commissionAmount.negated() as unknown as Decimal,
        referenceType: 'payout',
        referenceId: payout.id,
        description: 'Platform komisyonu',
      })
    }

    const refundEntry = await ledger.findByReference({
      sellerId: payout.sellerId,
      type: 'refund',
      referenceType: 'payout',
      referenceId: payout.id,
    })
    if (!refundEntry && payout.refundAmount.gt(0)) {
      await ledger.createEntry({
        sellerId: payout.sellerId,
        type: 'refund',
        amount: payout.refundAmount.negated() as unknown as Decimal,
        referenceType: 'payout',
        referenceId: payout.id,
        description: 'Iade kesintisi',
      })
    }

    const payoutEntry = await ledger.findByReference({
      sellerId: payout.sellerId,
      type: 'payout',
      referenceType: 'payout',
      referenceId: payout.id,
    })
    if (!payoutEntry && payout.status === 'payout_paid') {
      await ledger.createEntry({
        sellerId: payout.sellerId,
        type: 'payout',
        amount: payout.netAmount.negated() as unknown as Decimal,
        referenceType: 'payout',
        referenceId: payout.id,
        description: 'EFT',
      })
    }
  }

  const penalties = await prisma.penalty.findMany({
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  })

  for (const penalty of penalties) {
    const penaltyEntry = await ledger.findByReference({
      sellerId: penalty.sellerId,
      type: 'penalty',
      referenceType: 'penalty',
      referenceId: penalty.id,
    })
    if (!penaltyEntry) {
      await ledger.createEntry({
        sellerId: penalty.sellerId,
        type: 'penalty',
        amount: penalty.penaltyAmount.negated() as unknown as Decimal,
        referenceType: 'penalty',
        referenceId: penalty.id,
        description: `Ceza: ${penalty.reason}`,
      })
    }
  }
}

main()
  .then(async () => {
    await prisma.$disconnect()
  })
  .catch(async (error) => {
    console.error('[backfill-seller-ledger] failed', error)
    await prisma.$disconnect()
    process.exit(1)
  })
