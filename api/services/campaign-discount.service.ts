/**
 * Campaign discount service — notifies customers who have a product in their cart when a seller
 * starts a discount on that product (`product_discount_in_cart`).
 *
 * Phase 6 (2026-09-24): the favorite discount e-mail is closed. Favoriters get the
 * lowest-price-of-15-days e-mail instead (price-drop-dispatch.service), which wins over the cart
 * e-mail for the same user and product. Before deciding, the price pipeline of the discount's
 * products runs inline (markers, due boundaries, candidates), so the priority does not depend on
 * which job runs first.
 *
 * Each cart e-mail is a reservation (campaign-email-reservation.ts) written together with its
 * outbox row; the shared limits (7 days per user/product, 3 per user in 24 hours) are checked
 * when reserving and again at the send gate.
 */
import type { CampaignDispatchSource, Prisma, PrismaClient } from '@prisma/client'
import { getWebBaseUrl } from '../lib/platform-info'
import { reserveCampaignEmail } from './campaign-email-reservation'
import { getMarketingChannelStatus } from './marketing-channel.service'
import { recordNotification } from './notification-outbox.service'
import { processPriceChangeMarkers } from './price-change-reconcile.service'
import { evaluatePriceDropCandidates, materializeDuePredictions } from './price-drop-evaluation.service'
import { createMarketingConsentService } from './marketing-consent.service'

interface CampaignDiscountServiceDeps {
  prisma: PrismaClient
}

interface DiscountRuleForFingerprint {
  id: string
  startsAt: Date | null
  createdAt: Date
}

interface DiscountRuleForScope {
  scope: 'ALL_PRODUCTS' | 'CATEGORY' | 'PRODUCT'
  sellerId: string
  categoryId: string | null
  products: Array<{ productId: string }>
}

export interface CampaignDiscountTarget {
  userId: string
  email: string
  name: string | null
  source: CampaignDispatchSource
  productId: string
  productName: string
  productSlug: string
}

const PRODUCT_ID_PAGE_SIZE = 1000
const CART_ITEM_CHUNK_SIZE = 1000

/**
 * Cooldown penceresi: bir kullanıcıya aynı ürün için en fazla 7 günde bir kampanya e-postası
 * gönderilir (sepet ve 15 günlük fiyat bildirimi ortak). Kural artık rezervasyon modülünde.
 */
export { CAMPAIGN_EMAIL_COOLDOWN_DAYS } from './campaign-email-reservation'

/**
 * Deterministic fingerprint for one "campaign instance" of a discount rule.
 * A rule reactivated later (new startsAt) is treated as a distinct campaign,
 * so previously-notified users can be notified again.
 */
export function buildDiscountFingerprint(rule: DiscountRuleForFingerprint): string {
  return `${rule.id}:${(rule.startsAt ?? rule.createdAt).toISOString()}`
}

function buildProductScopeWhere(rule: DiscountRuleForScope): Prisma.ProductWhereInput {
  if (rule.scope === 'PRODUCT') {
    // Defense-in-depth: constrain to the rule's own seller so a mis-inserted
    // DiscountRuleProduct pointing at another tenant's product can never surface
    // that product (or its favoriters/cart-holders) in the audience.
    return { sellerId: rule.sellerId, id: { in: rule.products.map((entry) => entry.productId) } }
  }
  if (rule.scope === 'CATEGORY') {
    return { sellerId: rule.sellerId, categoryId: rule.categoryId }
  }
  return { sellerId: rule.sellerId }
}

function buildProductUrl(productSlug: string): string {
  return `${getWebBaseUrl()}/urun/${productSlug}`
}

function buildUnsubscribeUrl(optOutToken: string): string {
  return `${getWebBaseUrl()}/api/marketing/unsubscribe?token=${encodeURIComponent(optOutToken)}`
}

export function campaignCartEventKey(discountFingerprint: string, userId: string) {
  return `campaign-cart:${discountFingerprint}:user:${userId}`
}

export function createCampaignDiscountService({ prisma }: CampaignDiscountServiceDeps) {
  /**
   * CartItem has no Product relation, so the scoped product set is resolved
   * first (cursor-paginated), then matched against cart items in chunks.
   */
  async function collectScopedProductIds(productWhere: Prisma.ProductWhereInput): Promise<string[]> {
    const productIds: string[] = []
    let cursor: string | undefined

    for (;;) {
      const page = await prisma.product.findMany({
        where: productWhere,
        select: { id: true },
        orderBy: { id: 'asc' },
        take: PRODUCT_ID_PAGE_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      })
      if (page.length === 0) break
      for (const product of page) productIds.push(product.id)
      if (page.length < PRODUCT_ID_PAGE_SIZE) break
      cursor = page[page.length - 1]?.id
    }

    return productIds
  }

  async function resolveCartTargets(
    productWhere: Prisma.ProductWhereInput,
    sellerId: string,
  ): Promise<CampaignDiscountTarget[]> {
    const productIds = await collectScopedProductIds(productWhere)
    if (productIds.length === 0) return []

    const cartHitsByUserId = new Map<string, { userId: string; productId: string }>()

    for (let offset = 0; offset < productIds.length; offset += CART_ITEM_CHUNK_SIZE) {
      const chunk = productIds.slice(offset, offset + CART_ITEM_CHUNK_SIZE)
      const cartItems = await prisma.cartItem.findMany({
        where: { productId: { in: chunk } },
        include: { cart: { select: { userId: true } } },
      })

      for (const item of cartItems) {
        const userId = item.cart.userId
        if (!userId) continue // guest cart — excluded, no account to notify
        if (cartHitsByUserId.has(userId)) continue
        cartHitsByUserId.set(userId, { userId, productId: item.productId })
      }
    }

    if (cartHitsByUserId.size === 0) return []

    const userIds = Array.from(cartHitsByUserId.keys())
    const hitProductIds = Array.from(
      new Set(Array.from(cartHitsByUserId.values()).map((hit) => hit.productId)),
    )

    const [users, products] = await Promise.all([
      prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, email: true, name: true } }),
      // hitProductIds are already tenant-scoped (derived from collectScopedProductIds,
      // which used the sellerId-scoped productWhere). sellerId is added again here
      // anyway — harmless and strictly stronger defense-in-depth.
      prisma.product.findMany({
        where: { id: { in: hitProductIds }, sellerId },
        select: { id: true, name: true, slug: true },
      }),
    ])

    const userById = new Map(users.map((user) => [user.id, user]))
    const productById = new Map(products.map((product) => [product.id, product]))

    const targets: CampaignDiscountTarget[] = []
    for (const hit of cartHitsByUserId.values()) {
      const user = userById.get(hit.userId)
      const product = productById.get(hit.productId)
      if (!user || !product) continue
      targets.push({
        userId: hit.userId,
        email: user.email,
        name: user.name,
        source: 'cart',
        productId: product.id,
        productName: product.name,
        productSlug: product.slug,
      })
    }

    return targets
  }

  async function filterConsentedUserIds(userIds: string[]): Promise<Set<string>> {
    if (userIds.length === 0) return new Set()

    const consents = await prisma.marketingConsent.findMany({
      where: {
        userId: { in: userIds },
        emailConsentAt: { not: null },
        emailRevokedAt: null,
      },
      select: { userId: true },
    })

    return new Set(consents.map((consent) => consent.userId))
  }

  /**
   * Resolve the cart audience for a discount rule: users who have a discounted product in their
   * cart, opted into marketing email, excluding the seller's own account. Favoriting alone is no
   * longer a reason (phase 6); favoriters get the lowest-price e-mail instead.
   */
  async function resolveTargets(discountRuleId: string): Promise<CampaignDiscountTarget[]> {
    const rule = await prisma.discountRule.findUnique({
      where: { id: discountRuleId },
      include: {
        products: { select: { productId: true } },
        seller: { select: { userId: true } },
      },
    })
    if (!rule) return []

    const cartTargets = (await resolveCartTargets(buildProductScopeWhere(rule), rule.sellerId)).filter(
      (target) => target.userId !== rule.seller.userId,
    )
    if (cartTargets.length === 0) return []

    const consentedUserIds = await filterConsentedUserIds(cartTargets.map((target) => target.userId))
    return cartTargets.filter((target) => consentedUserIds.has(target.userId))
  }

  /**
   * Brings the price history of the discounted products up to date (markers, due rule
   * boundaries, candidate decisions) so the lowest-price priority below is deterministic.
   */
  async function syncPricePipeline(productIds: string[], sellerId: string) {
    if (!productIds.length) return
    for (let round = 0; round < 20; round += 1) {
      const processed = await processPriceChangeMarkers(prisma, {
        scope: { productIds, sellerIds: [sellerId] },
      })
      if (processed.explained + processed.reset + processed.ignored === 0) break
    }
    await materializeDuePredictions(prisma, { productIds })
    await evaluatePriceDropCandidates(prisma, { productIds, productLimit: productIds.length })
  }

  /**
   * Cart holders whose product has a lowest-price event for this campaign and who also
   * favorited it: the lowest-price e-mail wins, the cart e-mail is not written.
   */
  async function findPriceDropPriorityKeys(
    targets: CampaignDiscountTarget[],
    campaignStart: Date,
  ): Promise<Set<string>> {
    const productIds = [...new Set(targets.map((target) => target.productId))]
    const events = await prisma.priceDropEvent.findMany({
      where: {
        productId: { in: productIds },
        status: { in: ['pending', 'dispatching', 'dispatched'] },
        changeAt: { gte: campaignStart },
      },
      select: { productId: true },
    })
    const withEvent = new Set(events.map((event) => event.productId))
    if (!withEvent.size) return new Set()
    const favorites = await prisma.favoriteProduct.findMany({
      where: {
        userId: { in: targets.map((target) => target.userId) },
        productId: { in: [...withEvent] },
      },
      select: { userId: true, productId: true },
    })
    return new Set(favorites.map((row) => `${row.userId}:${row.productId}`))
  }

  /**
   * Queue the cart discount e-mails. Idempotent: a target already reserved for this campaign
   * instance (same fingerprint) is skipped. Each e-mail is reserved against the shared limits
   * and written to the outbox in the same transaction.
   */
  async function notifyDiscountAudience(params: {
    discountRuleId: string
    discountFingerprint: string
    sellerName: string
    now?: Date
  }): Promise<{ notified: number; superseded: number; skipped: number }> {
    const channel = await getMarketingChannelStatus(prisma, 'email')
    if (!channel.canSend) return { notified: 0, superseded: 0, skipped: 0 }
    const rule = await prisma.discountRule.findUnique({
      where: { id: params.discountRuleId },
      select: { sellerId: true, startsAt: true, createdAt: true },
    })
    if (!rule) return { notified: 0, superseded: 0, skipped: 0 }

    const targets = await resolveTargets(params.discountRuleId)
    if (targets.length === 0) return { notified: 0, superseded: 0, skipped: 0 }

    await syncPricePipeline([...new Set(targets.map((target) => target.productId))], rule.sellerId)
    const priority = await findPriceDropPriorityKeys(targets, rule.startsAt ?? rule.createdAt)

    const consents = await prisma.marketingConsent.findMany({
      where: { userId: { in: targets.map((target) => target.userId) } },
      select: { userId: true, optOutToken: true },
    })
    const optOutTokenByUserId = new Map(consents.map((consent) => [consent.userId, consent.optOutToken]))

    let notified = 0
    let superseded = 0
    let skipped = 0

    for (const target of targets) {
      const optOutToken = optOutTokenByUserId.get(target.userId)
      if (!optOutToken) {
        skipped += 1
        continue
      }
      if (priority.has(`${target.userId}:${target.productId}`)) {
        superseded += 1
        continue
      }

      const eventKey = campaignCartEventKey(params.discountFingerprint, target.userId)
      const reserved = await prisma.$transaction(async (tx) => {
        const reservation = await reserveCampaignEmail(tx, {
          userId: target.userId,
          productId: target.productId,
          source: target.source,
          fingerprint: params.discountFingerprint,
          eventKey,
          discountRuleId: params.discountRuleId,
          now: params.now ?? new Date(),
        })
        if (!reservation.ok) return false
        await recordNotification(tx, {
          userId: target.userId,
          type: 'product_discount_in_cart',
          eventKey,
          title: 'Sepetinizdeki üründe indirim başladı',
          body: `${target.productName} şimdi indirimde.`,
          data: {
            productName: target.productName,
            productUrl: buildProductUrl(target.productSlug),
            sellerName: params.sellerName,
            unsubscribeUrl: buildUnsubscribeUrl(optOutToken),
          },
          emailTo: target.email,
        })
        return true
      })

      if (reserved) notified += 1
      else skipped += 1
    }

    return { notified, superseded, skipped }
  }

  /**
   * Revoke a user's marketing email consent via their opt-out token
   * (one-click unsubscribe link). Idempotent: an already-revoked consent is
   * still treated as success. Returns null when the token matches no consent.
   */
  async function revokeMarketingEmailConsentByToken(
    token: string,
  ): Promise<{ revoked: true } | null> {
    return createMarketingConsentService(prisma).revokeByToken(token, 'unsubscribe_post')
  }

  /**
   * Revoke marketing email consent for every account matching an email address
   * (e.g. an inbound "RET" reply). Idempotent and a no-op when the user has no
   * consent row. Returns the number of consents newly revoked.
   */
  async function revokeMarketingEmailConsentByEmail(email: string): Promise<number> {
    return createMarketingConsentService(prisma).revokeByEmail(email)
  }

  /**
   * Grant marketing consent for a user. One consent record covers both the email
   * and SMS channels (business decision — a single opt-in). Idempotent: on an
   * existing row it (re)sets both ConsentAt timestamps, clears both RevokedAt
   * flags, and refreshes the recorded source.
   */
  async function grantMarketingConsent({
    userId,
    source,
  }: {
    userId: string
    source: 'signup' | 'account_settings'
  }): Promise<void> {
    void userId
    void source
    throw new Error('İYS hazırlığı tamamlanana kadar yeni pazarlama izni alınmıyor.')
  }

  /**
   * Revoke a user's marketing consent (both channels) from an authenticated
   * account action. Idempotent and a no-op success when the user has no row.
   */
  async function revokeMarketingConsentByUser({ userId }: { userId: string }): Promise<void> {
    const service = createMarketingConsentService(prisma)
    await service.revokeByUser(userId, 'email', 'account_settings')
    await service.revokeByUser(userId, 'sms', 'account_settings')
  }

  /**
   * Read a user's current marketing consent status per channel. A channel counts
   * as consented only when its ConsentAt is set and its RevokedAt is null.
   */
  async function getMarketingConsentStatus({
    userId,
  }: {
    userId: string
  }): Promise<{ emailConsented: boolean; smsConsented: boolean }> {
    const status = await createMarketingConsentService(prisma).getStatus(userId)
    return { emailConsented: status.emailConsented, smsConsented: status.smsConsented }
  }

  return {
    resolveTargets,
    notifyDiscountAudience,
    revokeMarketingEmailConsentByToken,
    revokeMarketingEmailConsentByEmail,
    grantMarketingConsent,
    revokeMarketingConsentByUser,
    getMarketingConsentStatus,
  }
}

export type CampaignDiscountService = ReturnType<typeof createCampaignDiscountService>
