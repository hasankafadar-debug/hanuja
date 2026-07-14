/**
 * Integration tests — satıcı kuponu + KDV dahil komisyon checkout pipeline.
 *
 * Bu testler gerçek domain fonksiyonlarını (allocateCouponDiscount,
 * calculateCommission, sumPayoutSnapshot) kullanarak checkout.service.ts'in
 * buildCheckoutDraft akışındaki satır-bazlı kupon dağıtımı + KDV'li komisyon
 * hesabını doğrular (Faz 1-3, bkz. api/services/checkout.service.ts).
 *
 * İş kararı: satıcı kuponu (Coupon.sellerId dolu) o satıcının satırlarına
 * dağıtılır ve komisyon tabanını düşürür; platform kuponu (sellerId null)
 * satır snapshot'larını hiç etkilemez (maliyeti platform emer — EFT indirimi
 * felsefesiyle aynı). 07-marketplace-finance-rules.md, CLAUDE.md §15.3.12-13.
 */
import { describe, expect, it } from 'vitest'
import { Decimal } from '../__mocks__/prisma-runtime'
import {
  allocateCouponDiscount,
  calculateCommission,
  sumPayoutSnapshot,
} from '../../api/domain/payout-calculator'

const COMMISSION_RATE = new Decimal('0.15')
const VAT_RATE = new Decimal('0.20')

interface RawLine {
  sellerId: string
  totalPrice: Decimal
}

function buildLineSnapshots(lines: RawLine[], couponSellerId: string | null, totalDiscount: Decimal) {
  const couponShareByIndex = lines.map(() => new Decimal(0))

  if (couponSellerId && totalDiscount.gt(0)) {
    const sellerLineIndices = lines
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => line.sellerId === couponSellerId)
    const shares = allocateCouponDiscount(
      sellerLineIndices.map(({ line }) => ({ totalPrice: line.totalPrice })),
      totalDiscount,
    )
    sellerLineIndices.forEach(({ index }, i) => {
      couponShareByIndex[index] = shares[i]!
    })
  }

  return lines.map((line, index) => {
    const couponDiscountAmount = couponShareByIndex[index]!
    const commissionBase = line.totalPrice.sub(couponDiscountAmount)
    const commissionAmount = calculateCommission(commissionBase, COMMISSION_RATE, VAT_RATE)
    const netPayoutAmount = commissionBase.sub(commissionAmount)
    return {
      sellerId: line.sellerId,
      totalPrice: line.totalPrice,
      couponDiscountAmount,
      commissionAmount,
      netPayoutAmount,
    }
  })
}

describe('checkout coupon + commission pipeline — seller-scoped coupon', () => {
  it('reference example: single line, 52.690 product, 5.269 coupon → 8.535,78 commission, 38.885,22 net', () => {
    const lines = buildLineSnapshots(
      [{ sellerId: 'seller-1', totalPrice: new Decimal(52690) }],
      'seller-1',
      new Decimal(5269),
    )

    expect(lines[0]!.couponDiscountAmount.toNumber()).toBe(5269)
    expect(lines[0]!.commissionAmount.toNumber()).toBe(8535.78)
    expect(lines[0]!.netPayoutAmount.toNumber()).toBeCloseTo(38885.22, 2)
  })

  it('distributes the discount only to the coupon-owning seller lines, other sellers untouched', () => {
    const lines = buildLineSnapshots(
      [
        { sellerId: 'seller-1', totalPrice: new Decimal(1000) },
        { sellerId: 'seller-2', totalPrice: new Decimal(2000) },
      ],
      'seller-1',
      new Decimal(100),
    )

    const s1 = lines.find((l) => l.sellerId === 'seller-1')!
    const s2 = lines.find((l) => l.sellerId === 'seller-2')!

    expect(s1.couponDiscountAmount.toNumber()).toBe(100)
    expect(s2.couponDiscountAmount.toNumber()).toBe(0)

    // seller-1 commission base = 1000 - 100 = 900 → 900 * 0.15 * 1.20 = 162
    expect(s1.commissionAmount.toNumber()).toBe(162)
    // seller-2 unaffected: 2000 * 0.15 * 1.20 = 360
    expect(s2.commissionAmount.toNumber()).toBe(360)
  })

  it('splits the coupon discount across multiple lines of the same seller with exact penny total', () => {
    const lines = buildLineSnapshots(
      [
        { sellerId: 'seller-1', totalPrice: new Decimal(300) },
        { sellerId: 'seller-1', totalPrice: new Decimal(700) },
      ],
      'seller-1',
      new Decimal(100),
    )

    expect(lines[0]!.couponDiscountAmount.toNumber()).toBe(30)
    expect(lines[1]!.couponDiscountAmount.toNumber()).toBe(70)

    const snapshot = sumPayoutSnapshot(lines)
    expect(snapshot.couponShareAmount.toNumber()).toBe(100)
    expect(snapshot.grossAmount.toNumber()).toBe(1000)
  })
})

describe('checkout coupon + commission pipeline — platform-wide coupon', () => {
  it('does NOT allocate any coupon share to line snapshots (platform absorbs the cost)', () => {
    // couponSellerId = null simulates a platform-wide coupon (Coupon.sellerId null)
    const lines = buildLineSnapshots(
      [
        { sellerId: 'seller-1', totalPrice: new Decimal(1000) },
        { sellerId: 'seller-2', totalPrice: new Decimal(2000) },
      ],
      null,
      new Decimal(100),
    )

    lines.forEach((line) => expect(line.couponDiscountAmount.toNumber()).toBe(0))

    // Commission bases are unaffected — full totalPrice used, matching pre-coupon behavior
    expect(lines[0]!.commissionAmount.toNumber()).toBe(180) // 1000 * 0.15 * 1.20
    expect(lines[1]!.commissionAmount.toNumber()).toBe(360) // 2000 * 0.15 * 1.20

    const snapshot = sumPayoutSnapshot(lines)
    expect(snapshot.couponShareAmount.toNumber()).toBe(0)
  })
})
