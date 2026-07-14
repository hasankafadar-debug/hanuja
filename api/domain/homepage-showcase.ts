/**
 * Homepage showcase selection — pure business rules, no persistence access.
 *
 * Two supplementary discovery sections on the storefront homepage:
 * - "Haftanın Favorileri": most-favorited products of the last 7 days,
 *   one per homepage featured group first, then filled to the limit.
 * - "Özel Kampanyalı Ürünler": products whose active DiscountRule campaign
 *   started within the recency window, ranked by highest discount percent.
 *
 * Callers (catalog service) are responsible for loading published + enriched
 * product candidates and the weekly favorite counts.
 */

export interface ShowcaseProduct {
  id: string
  categoryId: string | null
  name: string
  salesCount: number
  rankingDate: Date
  price: { toNumber(): number }
  compareAtPrice: { toNumber(): number } | null
  discountSource: { effectiveStartsAt: Date } | null
}

export interface ShowcaseGroup {
  key: string
  categoryIds: string[]
}

/** Neutral tie-break shared by all showcase orderings: newest first, then Turkish name order. */
function compareByRecencyThenName(left: ShowcaseProduct, right: ShowcaseProduct): number {
  return (
    right.rankingDate.getTime() - left.rankingDate.getTime() ||
    left.name.localeCompare(right.name, 'tr')
  )
}

/**
 * Selects the weekly-favorites showcase.
 *
 * Pass 1 — per featured group: the most weekly-favorited, not-yet-picked product
 *          whose categoryId belongs to the group (weekly count must be > 0).
 * Pass 2 — overall fill: remaining products with weekly count > 0, most favorited first.
 * Pass 3 — catalog fill: if still short (not enough favorited products), fill with any
 *          remaining published product by salesCount, then recency.
 *
 * Never exceeds `limit`; never picks the same product twice.
 */
export function selectWeeklyFavoriteShowcase<T extends ShowcaseProduct>(
  products: readonly T[],
  weeklyFavoriteCountByProductId: ReadonlyMap<string, number>,
  groups: ReadonlyArray<ShowcaseGroup>,
  limit = 20,
): T[] {
  const picks: T[] = []
  const pickedIds = new Set<string>()
  const weeklyCountOf = (product: ShowcaseProduct) =>
    weeklyFavoriteCountByProductId.get(product.id) ?? 0

  const byWeeklyCountDesc = (left: T, right: T) =>
    weeklyCountOf(right) - weeklyCountOf(left) || compareByRecencyThenName(left, right)

  // Pass 1 — one favorited product per homepage group.
  for (const group of groups) {
    if (picks.length >= limit) break
    const categoryIdSet = new Set(group.categoryIds)
    const best = products
      .filter(
        (product) =>
          !pickedIds.has(product.id) &&
          product.categoryId !== null &&
          categoryIdSet.has(product.categoryId) &&
          weeklyCountOf(product) > 0,
      )
      .sort(byWeeklyCountDesc)[0]

    if (best) {
      picks.push(best)
      pickedIds.add(best.id)
    }
  }

  // Pass 2 — fill with the next most weekly-favorited products overall.
  if (picks.length < limit) {
    const favoritedRest = products
      .filter((product) => !pickedIds.has(product.id) && weeklyCountOf(product) > 0)
      .sort(byWeeklyCountDesc)

    for (const product of favoritedRest) {
      if (picks.length >= limit) break
      picks.push(product)
      pickedIds.add(product.id)
    }
  }

  // Pass 3 — not enough favorited products: fill with any remaining published product.
  if (picks.length < limit) {
    const anyRest = products
      .filter((product) => !pickedIds.has(product.id))
      .sort(
        (left, right) =>
          right.salesCount - left.salesCount || compareByRecencyThenName(left, right),
      )

    for (const product of anyRest) {
      if (picks.length >= limit) break
      picks.push(product)
      pickedIds.add(product.id)
    }
  }

  return picks
}

/**
 * Selects the campaign-discount showcase.
 *
 * Candidates: products with an active DiscountRule campaign whose start reference
 * (`discountSource.effectiveStartsAt`) is on/after `cutoffDate`, and a real markdown
 * (compareAtPrice > price — guards divide-by-zero / non-discount rows).
 *
 * Ranked by highest discount percent against the real sale price. No filler when
 * fewer than `limit` qualify — supplementary section shows only genuine campaigns.
 */
export function selectCampaignDiscountShowcase<T extends ShowcaseProduct>(
  products: readonly T[],
  cutoffDate: Date,
  limit = 25,
): T[] {
  const discountPercentOf = (product: ShowcaseProduct) => {
    const compareAt = product.compareAtPrice?.toNumber() ?? 0
    return ((compareAt - product.price.toNumber()) / compareAt) * 100
  }

  return products
    .filter((product) => {
      if (!product.discountSource) return false
      if (product.discountSource.effectiveStartsAt < cutoffDate) return false
      const compareAt = product.compareAtPrice?.toNumber()
      return compareAt !== undefined && compareAt > product.price.toNumber()
    })
    .sort(
      (left, right) =>
        discountPercentOf(right) - discountPercentOf(left) ||
        compareByRecencyThenName(left, right),
    )
    .slice(0, limit)
}
