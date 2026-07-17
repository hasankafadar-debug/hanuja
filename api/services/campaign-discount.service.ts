/**
 * Campaign discount service — notifies customers who favorited or have-in-cart
 * a product when a seller starts a discount on that product.
 *
 * Audience resolution respects marketing consent (opt-in, not revoked) and
 * excludes the seller's own account. Dispatch is deduplicated per
 * (userId, discountFingerprint, source) so re-running notifyDiscountAudience
 * for the same campaign instance is idempotent.
 *
 * Scope, out of this chunk: queue/job wiring, HTTP routes, email templates.
 * notifyDiscountAudience creates in-app notifications + enqueues email via the
 * shared notification service; the email template mapping is added later.
 */
import type { CampaignDispatchSource, Prisma, PrismaClient } from '@prisma/client'
import { getWebBaseUrl } from '../lib/platform-info'
import { createNotificationService, type NotificationService } from './notification.service'

interface CampaignDiscountServiceDeps {
  prisma: PrismaClient
  notifications?: NotificationService
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
const FAVORITE_PAGE_SIZE = 1000

const MS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * Cooldown penceresi: bir kullanıcıya aynı ürün için en fazla 7 günde bir
 * kampanya e-postası gönderilir. Fingerprint'ten bağımsızdır; satıcının kuralı
 * silip yeniden oluşturarak (yeni fingerprint) aynı kitleyi tekrar spam'lemesini
 * engeller.
 */
export const CAMPAIGN_EMAIL_COOLDOWN_DAYS = 7

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

export function createCampaignDiscountService({
  prisma,
  notifications = createNotificationService({ prisma }),
}: CampaignDiscountServiceDeps) {
  async function resolveFavoriteTargets(
    productWhere: Prisma.ProductWhereInput,
  ): Promise<CampaignDiscountTarget[]> {
    // Cursor-paginated: a popular product can have an unbounded favorite count,
    // so pages are drained by stable id cursor and deduped incrementally.
    const targetsByUserId = new Map<string, CampaignDiscountTarget>()
    let cursor: string | undefined

    for (;;) {
      const page = await prisma.favoriteProduct.findMany({
        where: { product: productWhere },
        orderBy: { id: 'asc' },
        take: FAVORITE_PAGE_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        include: {
          user: { select: { id: true, email: true, name: true } },
          product: { select: { id: true, name: true, slug: true } },
        },
      })
      if (page.length === 0) break

      for (const favorite of page) {
        if (targetsByUserId.has(favorite.userId)) continue
        targetsByUserId.set(favorite.userId, {
          userId: favorite.userId,
          email: favorite.user.email,
          name: favorite.user.name,
          source: 'favorite',
          productId: favorite.product.id,
          productName: favorite.product.name,
          productSlug: favorite.product.slug,
        })
      }

      if (page.length < FAVORITE_PAGE_SIZE) break
      cursor = page[page.length - 1]?.id
    }

    return Array.from(targetsByUserId.values())
  }

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
   * Resolve the notification audience for a discount rule: users who favorited
   * or have-in-cart a discounted product, opted into marketing email, excluding
   * the seller's own account. A user present in both favorite and cart audiences
   * is counted once, under 'favorite'.
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

    const productWhere = buildProductScopeWhere(rule)

    const [favoriteTargets, cartTargets] = await Promise.all([
      resolveFavoriteTargets(productWhere),
      resolveCartTargets(productWhere, rule.sellerId),
    ])

    const favoriteUserIds = new Set(favoriteTargets.map((target) => target.userId))
    const dedupedCartTargets = cartTargets.filter((target) => !favoriteUserIds.has(target.userId))

    const combined = [...favoriteTargets, ...dedupedCartTargets].filter(
      (target) => target.userId !== rule.seller.userId,
    )
    if (combined.length === 0) return []

    const consentedUserIds = await filterConsentedUserIds(combined.map((target) => target.userId))

    return combined.filter((target) => consentedUserIds.has(target.userId))
  }

  /**
   * (userId, productId) pairs already emailed within the cooldown window. Keyed
   * independently of fingerprint, so a recreated rule (new fingerprint) cannot
   * re-email the same audience for the same product before the window elapses.
   * One batched query for all targets, then in-memory filtering.
   */
  async function findRecentlyDispatchedKeys(
    targets: CampaignDiscountTarget[],
  ): Promise<Set<string>> {
    const cutoff = new Date(Date.now() - CAMPAIGN_EMAIL_COOLDOWN_DAYS * MS_PER_DAY)
    const recent = await prisma.campaignEmailDispatch.findMany({
      where: {
        userId: { in: targets.map((target) => target.userId) },
        productId: { in: targets.map((target) => target.productId) },
        createdAt: { gte: cutoff },
      },
      select: { userId: true, productId: true },
    })

    const keys = new Set<string>()
    for (const row of recent) {
      if (row.productId === null) continue
      keys.add(`${row.userId}:${row.productId}`)
    }
    return keys
  }

  /**
   * Send discount notifications to the resolved audience. Idempotent: reruns
   * for the same (userId, discountFingerprint, source) skip the already-sent
   * dispatch via the unique constraint on CampaignEmailDispatch. Additionally,
   * a per-user/product cooldown (CAMPAIGN_EMAIL_COOLDOWN_DAYS) blocks re-emailing
   * the same audience across distinct campaign instances of the same product.
   */
  async function notifyDiscountAudience(params: {
    discountRuleId: string
    discountFingerprint: string
    sellerName: string
  }): Promise<{ notified: number }> {
    const targets = await resolveTargets(params.discountRuleId)
    if (targets.length === 0) return { notified: 0 }

    const consents = await prisma.marketingConsent.findMany({
      where: { userId: { in: targets.map((target) => target.userId) } },
      select: { userId: true, optOutToken: true },
    })
    const optOutTokenByUserId = new Map(consents.map((consent) => [consent.userId, consent.optOutToken]))

    const recentlyDispatchedKeys = await findRecentlyDispatchedKeys(targets)

    let notified = 0

    for (const target of targets) {
      const optOutToken = optOutTokenByUserId.get(target.userId)
      if (!optOutToken) continue

      // Cooldown: skip a target already emailed for this product in the window,
      // independent of the campaign fingerprint (closes the recreate loophole).
      if (recentlyDispatchedKeys.has(`${target.userId}:${target.productId}`)) continue

      try {
        await prisma.campaignEmailDispatch.create({
          data: {
            userId: target.userId,
            discountRuleId: params.discountRuleId,
            productId: target.productId,
            discountFingerprint: params.discountFingerprint,
            source: target.source,
            emailSentAt: new Date(),
          },
        })
      } catch {
        continue // already dispatched for this campaign instance — idempotent skip
      }

      const isFavoriteSource = target.source === 'favorite'

      await notifications.send({
        userId: target.userId,
        type: isFavoriteSource ? 'product_discount_favorited' : 'product_discount_in_cart',
        title: isFavoriteSource
          ? 'Favorilediğiniz üründe indirim başladı'
          : 'Sepetinizdeki üründe indirim başladı',
        body: `${target.productName} şimdi indirimde.`,
        data: {
          productName: target.productName,
          productUrl: buildProductUrl(target.productSlug),
          sellerName: params.sellerName,
          unsubscribeUrl: buildUnsubscribeUrl(optOutToken),
        },
        emailTo: target.email,
      })

      notified += 1
    }

    return { notified }
  }

  /**
   * Revoke a user's marketing email consent via their opt-out token
   * (one-click unsubscribe link). Idempotent: an already-revoked consent is
   * still treated as success. Returns null when the token matches no consent.
   */
  async function revokeMarketingEmailConsentByToken(
    token: string,
  ): Promise<{ revoked: true } | null> {
    const trimmed = token.trim()
    if (!trimmed) return null

    const consent = await prisma.marketingConsent.findUnique({
      where: { optOutToken: trimmed },
      select: { id: true, emailRevokedAt: true },
    })
    if (!consent) return null
    if (consent.emailRevokedAt) return { revoked: true } // already opted out

    await prisma.marketingConsent.update({
      where: { id: consent.id },
      data: { emailRevokedAt: new Date() },
    })
    return { revoked: true }
  }

  /**
   * Revoke marketing email consent for every account matching an email address
   * (e.g. an inbound "RET" reply). Idempotent and a no-op when the user has no
   * consent row. Returns the number of consents newly revoked.
   */
  async function revokeMarketingEmailConsentByEmail(email: string): Promise<number> {
    const normalized = email.trim().toLowerCase()
    if (!normalized) return 0

    const users = await prisma.user.findMany({
      where: { email: { equals: normalized, mode: 'insensitive' } },
      select: { id: true },
    })
    if (users.length === 0) return 0

    const result = await prisma.marketingConsent.updateMany({
      where: {
        userId: { in: users.map((user) => user.id) },
        emailRevokedAt: null,
      },
      data: { emailRevokedAt: new Date() },
    })
    return result.count
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
    const now = new Date()
    await prisma.marketingConsent.upsert({
      where: { userId },
      create: {
        userId,
        emailConsentAt: now,
        smsConsentAt: now,
        consentSource: source,
        optOutToken: crypto.randomUUID(),
      },
      update: {
        emailConsentAt: now,
        smsConsentAt: now,
        emailRevokedAt: null,
        smsRevokedAt: null,
        consentSource: source,
      },
    })
  }

  /**
   * Revoke a user's marketing consent (both channels) from an authenticated
   * account action. Idempotent and a no-op success when the user has no row.
   */
  async function revokeMarketingConsentByUser({ userId }: { userId: string }): Promise<void> {
    const now = new Date()
    await prisma.marketingConsent.updateMany({
      where: { userId },
      data: { emailRevokedAt: now, smsRevokedAt: now },
    })
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
    const consent = await prisma.marketingConsent.findUnique({
      where: { userId },
      select: {
        emailConsentAt: true,
        emailRevokedAt: true,
        smsConsentAt: true,
        smsRevokedAt: true,
      },
    })
    if (!consent) return { emailConsented: false, smsConsented: false }
    return {
      emailConsented: consent.emailConsentAt !== null && consent.emailRevokedAt === null,
      smsConsented: consent.smsConsentAt !== null && consent.smsRevokedAt === null,
    }
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
