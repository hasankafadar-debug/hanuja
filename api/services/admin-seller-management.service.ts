import type { PrismaClient } from '@prisma/client'
import { SellerHasCommercialHistoryError, NotFoundError } from '../lib/errors'
import {
  createPrivateDocumentStorage,
  isPrivateDocumentStorageKey,
  type PrivateDocumentStorage,
} from '../lib/private-document-storage'
import { deleteObject } from '../lib/r2'
import { enqueueProductSync } from '../jobs/search-index-sync.job'

export function createAdminSellerManagementService(
  prisma: PrismaClient,
  options: { privateDocumentStorage?: PrivateDocumentStorage } = {},
) {
  async function getCommercialHistoryCounts(sellerId: string) {
    const [
      orderLines,
      payouts,
      ledgerEntries,
      sellerInvoices,
      orderInvoices,
      penalties,
      shipments,
      fulfillmentRisks,
      orderEmailAliases,
      couponUsages,
    ] = await Promise.all([
      prisma.orderLine.count({ where: { sellerId } }),
      prisma.payout.count({ where: { sellerId } }),
      prisma.sellerLedgerEntry.count({ where: { sellerId } }),
      prisma.sellerInvoice.count({ where: { sellerId } }),
      prisma.orderSellerInvoice.count({ where: { sellerId } }),
      prisma.penalty.count({ where: { sellerId } }),
      prisma.shipment.count({ where: { sellerId } }),
      prisma.fulfillmentRisk.count({ where: { sellerId } }),
      prisma.orderEmailAlias.count({ where: { sellerId } }),
      prisma.couponUsage.count({ where: { coupon: { sellerId } } }),
    ])

    return {
      orderLines,
      payouts,
      ledgerEntries,
      sellerInvoices,
      orderInvoices,
      penalties,
      shipments,
      fulfillmentRisks,
      orderEmailAliases,
      couponUsages,
    }
  }

  async function deleteSeller(params: { sellerId: string; adminActorId: string }) {
    const seller = await prisma.seller.findUnique({
      where: { id: params.sellerId },
      include: {
        user: { select: { id: true, email: true } },
        profile: { select: { logoUrl: true, bannerUrl: true } },
        documents: { select: { fileKey: true } },
        products: { select: { id: true, name: true, images: { select: { url: true } } } },
      },
    })
    if (!seller) throw new NotFoundError('Seller', params.sellerId)

    const blockingCounts = await getCommercialHistoryCounts(params.sellerId)
    if (Object.values(blockingCounts).some((count) => count > 0)) {
      throw new SellerHasCommercialHistoryError(blockingCounts)
    }

    const privateDocumentKeys = seller.documents
      .map((document) => document.fileKey)
      .filter(isPrivateDocumentStorageKey)
    const legacyR2DocumentKeys = seller.documents
      .map((document) => document.fileKey)
      .filter((key) => !isPrivateDocumentStorageKey(key))

    // Private KYC files are deleted before their database rows. If the encrypted
    // volume is unavailable, abort deletion rather than leaving undeletable KYC
    // bytes behind after the seller record disappears.
    if (privateDocumentKeys.length > 0) {
      const privateStorage = options.privateDocumentStorage ?? createPrivateDocumentStorage()
      for (const key of new Set(privateDocumentKeys)) {
        await privateStorage.delete(key)
      }
    }

    const productIds = seller.products.map((product) => product.id)
    const productUrls = seller.products.flatMap((product) =>
      product.images.map((image) => image.url),
    )
    const profileUrls = [seller.profile?.logoUrl, seller.profile?.bannerUrl].filter(
      (url): url is string => Boolean(url),
    )
    const supportTickets = await prisma.supportTicket.findMany({
      where: { sellerId: seller.id },
      select: {
        id: true,
        messages: {
          select: {
            attachments: { select: { mediaAssetId: true } },
          },
        },
      },
    })
    const supportMediaIds = supportTickets.flatMap((ticket) =>
      ticket.messages.flatMap((message) =>
        message.attachments.map((attachment) => attachment.mediaAssetId),
      ),
    )
    const mediaAssets = await prisma.mediaAsset.findMany({
      where: {
        OR: [
          { uploadedBy: { in: [seller.id, seller.user.id] } },
          { url: { in: [...productUrls, ...profileUrls] } },
          { id: { in: supportMediaIds } },
        ],
        homeSlideMedia: { none: {} },
        homeSlidePoster: { none: {} },
        homePromoMedia: { none: {} },
        customerSupportAttachments: { none: {} },
      },
      select: { id: true, key: true },
    })
    const couponIds = (
      await prisma.coupon.findMany({
        where: { sellerId: seller.id },
        select: { id: true },
      })
    ).map((coupon) => coupon.id)
    const discountRuleIds = (
      await prisma.discountRule.findMany({
        where: { sellerId: seller.id },
        select: { id: true },
      })
    ).map((rule) => rule.id)

    await prisma.$transaction(
      async (tx) => {
        await tx.supportTicket.deleteMany({
          where: { id: { in: supportTickets.map((ticket) => ticket.id) } },
        })
        await tx.mediaAsset.deleteMany({
          where: { id: { in: mediaAssets.map((asset) => asset.id) } },
        })
        await tx.cartItem.deleteMany({ where: { productId: { in: productIds } } })
        await tx.coupon.deleteMany({ where: { id: { in: couponIds } } })
        await tx.discountRuleProduct.deleteMany({
          where: { discountRuleId: { in: discountRuleIds } },
        })
        await tx.discountRule.deleteMany({ where: { id: { in: discountRuleIds } } })
        await tx.product.deleteMany({ where: { id: { in: productIds } } })
        await tx.fulfillmentExtensionRequest.deleteMany({ where: { sellerId: seller.id } })
        await tx.sellerBankDetailHistory.deleteMany({ where: { sellerId: seller.id } })
        await tx.sellerBankDetail.deleteMany({ where: { sellerId: seller.id } })
        await tx.sellerDocument.deleteMany({ where: { sellerId: seller.id } })
        await tx.sellerProfile.deleteMany({ where: { sellerId: seller.id } })
        await tx.seller.delete({ where: { id: seller.id } })

        await tx.notification.deleteMany({ where: { userId: seller.user.id } })
        const carts = await tx.cart.findMany({
          where: { userId: seller.user.id },
          select: { id: true },
        })
        await tx.cartItem.deleteMany({ where: { cartId: { in: carts.map((cart) => cart.id) } } })
        await tx.cart.deleteMany({ where: { id: { in: carts.map((cart) => cart.id) } } })
        await tx.address.deleteMany({ where: { userId: seller.user.id } })
        await tx.session.deleteMany({ where: { userId: seller.user.id } })
        await tx.account.deleteMany({ where: { userId: seller.user.id } })
        await tx.verification.deleteMany({ where: { identifier: seller.user.email } })
        await tx.user.delete({ where: { id: seller.user.id } })

        await tx.adminAuditLog.create({
          data: {
            actorId: params.adminActorId,
            actionType: 'seller_deleted',
            targetType: 'seller',
            targetId: seller.id,
            previousData: {
              displayName: seller.displayName,
              email: seller.user.email,
              status: seller.status,
              productCount: seller.products.length,
            },
            newData: { deleted: true },
          },
        })
      },
      { timeout: 60_000 },
    )

    await Promise.all(
      productIds.map((productId) =>
        enqueueProductSync({ operation: 'delete', entityId: productId }).catch((error) => {
          console.error('[seller-delete] Search sync enqueue failed', error)
        }),
      ),
    )

    const storageKeys = [
      ...mediaAssets.flatMap((asset) => (asset.key ? [asset.key] : [])),
      ...legacyR2DocumentKeys,
    ]
    const failedMediaKeys: string[] = []
    for (const key of new Set(storageKeys)) {
      try {
        await deleteObject(key)
      } catch {
        failedMediaKeys.push(key)
      }
    }

    return { id: seller.id, failedMediaKeys }
  }

  return { deleteSeller, getCommercialHistoryCounts }
}
