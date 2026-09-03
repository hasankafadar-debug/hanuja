/**
 * Targeted repair for the only known pre-fix seller statement: Mosaiss.
 *
 * Default mode is read-only. Pass --apply only after production deploy and
 * after reviewing the dry-run output. The script never deletes or rewrites a
 * ledger amount; it reveals/reuses a correct accrual or appends the missing
 * payment-confirmed accrual with an idempotent event key.
 *
 * Usage:
 *   pnpm ledger:repair-mosaiss
 *   pnpm ledger:repair-mosaiss --apply
 */
import { Prisma } from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/client'
import prisma from '../../api/lib/prisma'
import { createSellerLedgerRepository } from '../../api/repositories/seller-ledger.repository'

const TARGET_SELLER = 'mosaiss'
const REPAIR_ACTOR_ID = 'repair_mosaiss_ledger'

function money(value: Decimal) {
  return value.toFixed(2)
}

function assertAmount(label: string, actual: Decimal, expected: Decimal) {
  if (!actual.equals(expected)) {
    throw new Error(`${label}: beklenen ${money(expected)}, bulunan ${money(actual)}`)
  }
}

async function resolveTargetSeller() {
  const sellers = await prisma.seller.findMany({
    where: {
      OR: [
        { slug: { equals: TARGET_SELLER, mode: 'insensitive' } },
        { displayName: { equals: TARGET_SELLER, mode: 'insensitive' } },
      ],
    },
    select: { id: true, slug: true, displayName: true, sellerNumber: true },
  })
  if (sellers.length !== 1) {
    throw new Error(
      `Mosaiss hedefi tekil çözümlenemedi; eşleşme sayısı: ${sellers.length}`,
    )
  }
  return sellers[0]!
}

async function main() {
  const unknownArgs = process.argv.slice(2).filter((arg) => arg !== '--apply')
  if (unknownArgs.length > 0) {
    throw new Error(`Desteklenmeyen argüman: ${unknownArgs.join(', ')}`)
  }
  const apply = process.argv.includes('--apply')
  const seller = await resolveTargetSeller()
  const ledger = createSellerLedgerRepository(prisma)

  const orders = await prisma.order.findMany({
    where: {
      lines: { some: { sellerId: seller.id } },
      payments: { some: { status: 'confirmed' } },
      cancellations: { some: { sellerId: seller.id } },
    },
    select: {
      id: true,
      publicNumber: true,
      paymentConfirmedAt: true,
      lines: {
        where: { sellerId: seller.id },
        select: {
          id: true,
          quantity: true,
          totalPrice: true,
          couponDiscountAmount: true,
        },
      },
      payments: {
        where: { status: 'confirmed' },
        select: { id: true, confirmedAt: true },
        orderBy: { confirmedAt: 'desc' },
        take: 1,
      },
      cancellations: {
        where: { sellerId: seller.id },
        select: {
          id: true,
          createdAt: true,
          grossProductAmount: true,
          couponAdjustmentAmount: true,
          sellerAdjustmentAmount: true,
          commissionAdjustmentAmount: true,
          items: {
            select: {
              id: true,
              orderLineId: true,
              grossProductAmount: true,
              couponAdjustmentAmount: true,
              sellerAdjustmentAmount: true,
              commissionAdjustmentAmount: true,
            },
          },
        },
        orderBy: { createdAt: 'asc' },
      },
      refundTransactions: {
        where: { sellerId: seller.id, sourceType: 'cancellation' },
        select: {
          id: true,
          sourceId: true,
          createdAt: true,
          grossProductAmount: true,
          couponAdjustmentAmount: true,
        },
      },
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  })

  if (orders.length === 0) {
    throw new Error('Mosaiss için onaylı ödeme + iptal içeren sipariş bulunamadı')
  }

  console.log(
    `[repair-mosaiss-ledger] mode=${apply ? 'APPLY' : 'DRY-RUN'} seller=${seller.displayName} (#${seller.sellerNumber}, ${seller.id}) orders=${orders.length}`,
  )

  let changedOrders = 0
  for (const order of orders) {
    const confirmedAt = order.paymentConfirmedAt ?? order.payments[0]?.confirmedAt
    if (!confirmedAt) throw new Error(`Sipariş ${order.id}: ödeme onay zamanı yok`)

    const grossSale = order.lines.reduce(
      (sum, line) => sum.add(line.totalPrice),
      new Decimal(0),
    )
    const sellerCoupon = order.lines.reduce(
      (sum, line) => sum.add(line.couponDiscountAmount),
      new Decimal(0),
    )
    if (sellerCoupon.gt(0)) {
      const legacySnapshotMissing = order.cancellations.some(
        (cancellation) =>
          cancellation.grossProductAmount.eq(0) ||
          cancellation.items.some((item) => item.grossProductAmount.eq(0)),
      )
      if (legacySnapshotMissing) {
        throw new Error(
          `Sipariş ${order.id}: satıcı kuponlu eski iptalin brüt snapshot'ı yok; otomatik onarım güvenli değil`,
        )
      }
    }

    const saleEntries = await prisma.sellerLedgerEntry.findMany({
      where: {
        sellerId: seller.id,
        type: 'sale',
        referenceType: 'order',
        referenceId: order.id,
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    })
    if (saleEntries.length > 1) {
      throw new Error(`Sipariş ${order.id}: birden fazla satış ledger kaydı bulundu`)
    }
    if (saleEntries[0]) assertAmount('Satış tahakkuku', saleEntries[0].amount, grossSale)
    const expectedSaleEventKey = `payment-confirmed:sale:${order.id}:${seller.id}`
    if (saleEntries[0]?.eventKey && saleEntries[0].eventKey !== expectedSaleEventKey) {
      throw new Error(`Sipariş ${order.id}: satış kaydında beklenmeyen eventKey var`)
    }

    const couponEntries = await prisma.sellerLedgerEntry.findMany({
      where: {
        sellerId: seller.id,
        type: 'coupon_share',
        referenceType: 'order',
        referenceId: order.id,
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    })
    if (couponEntries.length > 1) {
      throw new Error(`Sipariş ${order.id}: birden fazla kupon ledger kaydı bulundu`)
    }
    if (couponEntries[0]) {
      assertAmount('Satıcı kuponu tahakkuku', couponEntries[0].amount, sellerCoupon.negated())
    }
    const expectedCouponEventKey = `payment-confirmed:coupon-share:${order.id}:${seller.id}`
    if (couponEntries[0]?.eventKey && couponEntries[0].eventKey !== expectedCouponEventKey) {
      throw new Error(`Sipariş ${order.id}: kupon kaydında beklenmeyen eventKey var`)
    }

    const cancellationById = new Map(order.cancellations.map((item) => [item.id, item]))
    const refundPlans = []
    for (const refund of order.refundTransactions) {
      const cancellation = cancellationById.get(refund.sourceId)
      if (!cancellation) {
        throw new Error(`Refund ${refund.id}: iptal kaydı bulunamadı`)
      }
      const itemPlans = cancellation.items.map((item) => ({
        item,
        gross: item.grossProductAmount.gt(0)
          ? item.grossProductAmount
          : item.sellerAdjustmentAmount
              .add(item.commissionAdjustmentAmount)
              .add(item.couponAdjustmentAmount),
        coupon: item.couponAdjustmentAmount,
      }))
      const itemGross = itemPlans.reduce(
        (sum, item) => sum.add(item.gross),
        new Decimal(0),
      )
      const itemCoupon = itemPlans.reduce(
        (sum, item) => sum.add(item.coupon),
        new Decimal(0),
      )
      const gross = cancellation.grossProductAmount.gt(0)
        ? cancellation.grossProductAmount
        : itemGross.gt(0)
          ? itemGross
          : cancellation.sellerAdjustmentAmount
              .add(cancellation.commissionAdjustmentAmount)
              .add(cancellation.couponAdjustmentAmount)
      const coupon = cancellation.couponAdjustmentAmount.gt(0)
        ? cancellation.couponAdjustmentAmount
        : itemCoupon
      const refundEntries = await prisma.sellerLedgerEntry.findMany({
        where: {
          sellerId: seller.id,
          type: 'refund',
          referenceType: 'refund_transaction',
          referenceId: refund.id,
        },
      })
      if (refundEntries.length !== 1) {
        throw new Error(
          `Refund ${refund.id}: tam bir refund ledger kaydı bekleniyordu, bulunan ${refundEntries.length}`,
        )
      }
      const expectedRefundEventKey = `refund:product:${refund.id}`
      if (
        refundEntries[0]!.eventKey &&
        refundEntries[0]!.eventKey !== expectedRefundEventKey
      ) {
        throw new Error(`Refund ${refund.id}: beklenmeyen eventKey var`)
      }
      assertAmount('İptal ledger kaydı', refundEntries[0]!.amount, gross.negated())
      refundPlans.push({
        refund,
        cancellation,
        gross,
        coupon,
        itemPlans,
        entry: refundEntries[0]!,
      })
    }

    const needsSale = !saleEntries[0]
    const needsSaleMetadata = Boolean(
      saleEntries[0] &&
        (!saleEntries[0].visibleToSeller ||
          saleEntries[0].eventKey !== expectedSaleEventKey ||
          saleEntries[0].effectiveAt.getTime() !== confirmedAt.getTime()),
    )
    const needsCoupon = sellerCoupon.gt(0) && !couponEntries[0]
    const needsCouponMetadata = Boolean(
      couponEntries[0] &&
        (!couponEntries[0].visibleToSeller ||
          couponEntries[0].eventKey !== expectedCouponEventKey ||
          couponEntries[0].effectiveAt.getTime() !== confirmedAt.getTime()),
    )
    const needsRefundMetadata = refundPlans.some(
      ({ refund, entry }) =>
        !entry.visibleToSeller ||
        entry.eventKey !== `refund:product:${refund.id}` ||
        entry.effectiveAt.getTime() !== refund.createdAt.getTime(),
    )
    const needsSnapshots = refundPlans.some(
      ({ refund, cancellation, gross, coupon, itemPlans }) =>
        !refund.grossProductAmount.equals(gross) ||
        !refund.couponAdjustmentAmount.equals(coupon) ||
        !cancellation.grossProductAmount.equals(gross) ||
        !cancellation.couponAdjustmentAmount.equals(coupon) ||
        itemPlans.some(
          ({ item, gross: itemGrossAmount, coupon: itemCouponAmount }) =>
            !item.grossProductAmount.equals(itemGrossAmount) ||
            !item.couponAdjustmentAmount.equals(itemCouponAmount),
        ),
    )
    const expectedOrderBalance = refundPlans.reduce(
      (balance, { gross, coupon }) => balance.sub(gross).add(coupon),
      grossSale.sub(sellerCoupon),
    )
    const hasChanges =
      needsSale ||
      needsSaleMetadata ||
      needsCoupon ||
      needsCouponMetadata ||
      needsRefundMetadata ||
      needsSnapshots

    const currentVisibleBalance = await prisma.sellerLedgerEntry.aggregate({
      where: { sellerId: seller.id, visibleToSeller: true },
      _sum: { amount: true },
    })
    console.log(
      `[repair-mosaiss-ledger] order=#${order.publicNumber ?? order.id} gross=${money(grossSale)} coupon=${money(sellerCoupon)} expectedOrderBalance=${money(expectedOrderBalance)} currentSellerBalance=${money(currentVisibleBalance._sum.amount ?? new Decimal(0))} actions=${hasChanges ? [needsSale ? 'create-sale' : '', needsSaleMetadata ? 'reveal-sale' : '', needsCoupon ? 'create-coupon' : '', needsCouponMetadata ? 'fix-coupon-metadata' : '', needsRefundMetadata ? 'fix-refund-metadata' : '', needsSnapshots ? 'backfill-snapshots' : ''].filter(Boolean).join(',') : 'none'}`,
    )

    if (!apply || !hasChanges) continue

    await prisma.$transaction(
      async (tx) => {
        if (needsSale) {
          await ledger.createEntry(
            {
              sellerId: seller.id,
              type: 'sale',
              amount: grossSale,
              eventKey: expectedSaleEventKey,
              effectiveAt: confirmedAt,
              referenceType: 'order',
              referenceId: order.id,
              description: 'Ödemesi onaylanan brüt ürün satışı',
              createdBy: REPAIR_ACTOR_ID,
              visibleToSeller: true,
            },
            tx,
          )
        } else if (needsSaleMetadata) {
          await tx.sellerLedgerEntry.update({
            where: { id: saleEntries[0]!.id },
            data: {
              eventKey: expectedSaleEventKey,
              effectiveAt: confirmedAt,
              visibleToSeller: true,
            },
          })
        }

        if (needsCoupon) {
          await ledger.createEntry(
            {
              sellerId: seller.id,
              type: 'coupon_share',
              amount: sellerCoupon.negated(),
              eventKey: expectedCouponEventKey,
              effectiveAt: confirmedAt,
              referenceType: 'order',
              referenceId: order.id,
              description: 'Satıcı tarafından karşılanan kupon payı',
              createdBy: REPAIR_ACTOR_ID,
              visibleToSeller: true,
            },
            tx,
          )
        } else if (needsCouponMetadata) {
          await tx.sellerLedgerEntry.update({
            where: { id: couponEntries[0]!.id },
            data: {
              eventKey: expectedCouponEventKey,
              effectiveAt: confirmedAt,
              visibleToSeller: true,
            },
          })
        }

        for (const { refund, cancellation, gross, coupon, itemPlans, entry } of refundPlans) {
          await tx.orderCancellation.update({
            where: { id: cancellation.id },
            data: { grossProductAmount: gross, couponAdjustmentAmount: coupon },
          })
          await tx.refundTransaction.update({
            where: { id: refund.id },
            data: { grossProductAmount: gross, couponAdjustmentAmount: coupon },
          })
          for (const { item, gross: itemGrossAmount, coupon: itemCouponAmount } of itemPlans) {
            await tx.orderCancellationItem.update({
              where: { id: item.id },
              data: {
                grossProductAmount: itemGrossAmount,
                couponAdjustmentAmount: itemCouponAmount,
              },
            })
          }
          await tx.sellerLedgerEntry.update({
            where: { id: entry.id },
            data: {
              eventKey: `refund:product:${refund.id}`,
              effectiveAt: refund.createdAt,
              visibleToSeller: true,
            },
          })
        }

        await tx.adminAuditLog.create({
          data: {
            actorId: REPAIR_ACTOR_ID,
            actionType: 'manual_ledger_adjustment',
            targetType: 'seller_ledger_repair',
            targetId: order.id,
            previousData: {
              saleEntryId: saleEntries[0]?.id ?? null,
              saleVisible: saleEntries[0]?.visibleToSeller ?? false,
            },
            newData: {
              sellerId: seller.id,
              grossSale: money(grossSale),
              sellerCoupon: money(sellerCoupon),
              paymentConfirmedAt: confirmedAt.toISOString(),
              refundIds: refundPlans.map(({ refund }) => refund.id),
            },
            reason: 'Mosaiss canlı test ekstresindeki eksik ödeme tahakkukunun onarımı',
          },
        })
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    )
    changedOrders++
  }

  const finalBalance = await prisma.sellerLedgerEntry.aggregate({
    where: { sellerId: seller.id, visibleToSeller: true },
    _sum: { amount: true },
  })
  console.log(
    `[repair-mosaiss-ledger] completed mode=${apply ? 'APPLY' : 'DRY-RUN'} changedOrders=${changedOrders} visibleBalance=${money(finalBalance._sum.amount ?? new Decimal(0))}`,
  )
}

main()
  .then(async () => {
    await prisma.$disconnect()
  })
  .catch(async (error) => {
    console.error('[repair-mosaiss-ledger] failed', error)
    await prisma.$disconnect()
    process.exit(1)
  })
