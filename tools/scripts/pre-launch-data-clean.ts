#!/usr/bin/env tsx
/**
 * Lansman oncesi dar kapsamli veri temizligi.
 *
 * Yalniz mevcut saticilari, bu saticilarin kullanici hesaplarini, urunlerini,
 * urun/satici medyasini ve bunlara bagli siparis-finans demo verisini siler.
 * Musteriler, kategoriler, SEO calismalari, audit loglari, arama gecmisi,
 * CMS ve blog icerikleri korunur.
 */
import { config as loadDotEnv } from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PrismaClient, Prisma } from '@prisma/client'
import { deleteObject } from '../../api/lib/r2'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '../../')

type CleanupExpectations = {
  sellerIds: string[]
  sellers: number
  products: number
  orders: number
}

type Mode = (
  | { kind: 'dry-run' }
  | { kind: 'confirm'; databaseName: string }
) & CleanupExpectations
type DbClient = PrismaClient | Prisma.TransactionClient

type CleanupScope = {
  sellerIds: string[]
  sellerUserIds: string[]
  sellerEmails: string[]
  productIds: string[]
  orderIds: string[]
  supportTicketIds: string[]
  customerSupportTicketIds: string[]
  returnRequestIds: string[]
  returnMessageIds: string[]
  disputeIds: string[]
  couponIds: string[]
  discountRuleIds: string[]
  mediaAssetIds: string[]
  storageKeys: string[]
}

type CleanupResult = {
  deleted: Array<[string, number]>
  failedStorageKeys: string[]
}

function readIntegerFlag(argv: string[], name: string): number | null {
  const values = argv.filter((arg) => arg.startsWith(`${name}=`))
  if (values.length !== 1) return null
  const value = Number(values[0]?.slice(name.length + 1))
  return Number.isInteger(value) && value >= 0 ? value : null
}

export function parseMode(argv: string[]): Mode | null {
  const dryRun = argv.filter((arg) => arg === '--dry-run')
  const confirms = argv.filter((arg) => arg.startsWith('--confirm='))
  const sellerIdFlags = argv.filter((arg) => arg.startsWith('--seller-ids='))
  const knownPrefixes = [
    '--confirm=',
    '--seller-ids=',
    '--expect-sellers=',
    '--expect-products=',
    '--expect-orders=',
  ]
  const unknown = argv.filter(
    (arg) => arg !== '--dry-run' && !knownPrefixes.some((prefix) => arg.startsWith(prefix)),
  )
  if (unknown.length > 0 || dryRun.length + confirms.length !== 1) return null
  if (sellerIdFlags.length !== 1) return null
  const sellerIds = [
    ...new Set(
      (sellerIdFlags[0]?.slice('--seller-ids='.length) ?? '')
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean),
    ),
  ]
  const sellers = readIntegerFlag(argv, '--expect-sellers')
  const products = readIntegerFlag(argv, '--expect-products')
  const orders = readIntegerFlag(argv, '--expect-orders')
  if (
    sellerIds.length === 0 ||
    sellers === null ||
    products === null ||
    orders === null ||
    sellers !== sellerIds.length
  ) return null

  const expectations = { sellerIds, sellers, products, orders }
  if (dryRun.length === 1) return { kind: 'dry-run', ...expectations }
  const databaseName = confirms[0]?.slice('--confirm='.length).trim() ?? ''
  return databaseName ? { kind: 'confirm', databaseName, ...expectations } : null
}

export function databaseNameFromUrl(databaseUrl: string): string {
  const url = new URL(databaseUrl)
  return decodeURIComponent(url.pathname.replace(/^\//, '').split('/')[0] ?? '')
}

export function sanitizeCmsHref(href: string): { href: string; active: boolean } {
  if (/^\/(urun|magaza)\//i.test(href.trim())) return { href: '/', active: false }
  return { href, active: true }
}

function describeTarget(databaseUrl: string): string {
  try {
    const url = new URL(databaseUrl)
    return `${url.host}/${databaseNameFromUrl(databaseUrl) || '(db adi yok)'}`
  } catch {
    return '(DATABASE_URL parse edilemedi)'
  }
}

function printUsage(): void {
  console.error('\nHanuja Lansman Oncesi Dar Kapsamli Temizlik')
  console.error('Kullanim:')
  console.error('  pnpm launch:clean-data --dry-run --seller-ids=<id1,id2,id3> --expect-sellers=3 --expect-products=19 --expect-orders=19')
  console.error('  pnpm launch:clean-data --confirm=<veritabani_adi> --seller-ids=<id1,id2,id3> --expect-sellers=3 --expect-products=19 --expect-orders=19')
}

function ids(rows: Array<{ id: string }>): string[] {
  return rows.map((row) => row.id)
}

async function buildScope(prisma: DbClient, sellerIds: string[]): Promise<CleanupScope> {
  const sellers = await prisma.seller.findMany({
    where: { id: { in: sellerIds } },
    select: {
      id: true,
      userId: true,
      user: { select: { email: true } },
      profile: { select: { logoUrl: true, bannerUrl: true } },
      documents: { select: { fileKey: true } },
    },
  })
  const selectedSellerIds = sellers.map((seller) => seller.id)
  const sellerUserIds = sellers.map((seller) => seller.userId)
  const sellerEmails = sellers.map((seller) => seller.user.email)

  const products = await prisma.product.findMany({
    where: { sellerId: { in: selectedSellerIds } },
    select: { id: true, images: { select: { url: true } } },
  })
  const productIds = ids(products)

  const orders = await prisma.order.findMany({
    where: {
      OR: [
        { customerId: { in: sellerUserIds } },
        { lines: { some: { OR: [{ sellerId: { in: selectedSellerIds } }, { productId: { in: productIds } }] } } },
      ],
    },
    select: { id: true },
  })
  const orderIds = ids(orders)

  const [supportTickets, customerSupportTickets, returnRequests, disputes, coupons, discountRules] =
    await Promise.all([
      prisma.supportTicket.findMany({
        where: { OR: [{ sellerId: { in: selectedSellerIds } }, { orderId: { in: orderIds } }] },
        select: { id: true },
      }),
      prisma.customerSupportTicket.findMany({
        where: { OR: [{ orderId: { in: orderIds } }, { customerId: { in: sellerUserIds } }] },
        select: { id: true },
      }),
      prisma.returnRequest.findMany({ where: { orderId: { in: orderIds } }, select: { id: true } }),
      prisma.dispute.findMany({ where: { orderId: { in: orderIds } }, select: { id: true } }),
      prisma.coupon.findMany({ where: { sellerId: { in: selectedSellerIds } }, select: { id: true } }),
      prisma.discountRule.findMany({ where: { sellerId: { in: selectedSellerIds } }, select: { id: true } }),
    ])

  const returnRequestIds = ids(returnRequests)
  const returnMessages = await prisma.returnMessage.findMany({
    where: { returnRequestId: { in: returnRequestIds } },
    select: { id: true },
  })
  const returnMessageIds = ids(returnMessages)
  const disputeIds = ids(disputes)

  const productUrls = products.flatMap((product) => product.images.map((image) => image.url))
  const profileUrls = sellers.flatMap((seller) =>
    [seller.profile?.logoUrl, seller.profile?.bannerUrl].filter((url): url is string => Boolean(url)),
  )
  const mediaAssets = await prisma.mediaAsset.findMany({
    where: {
      OR: [
        { uploadedBy: { in: [...selectedSellerIds, ...sellerUserIds] } },
        { url: { in: [...productUrls, ...profileUrls] } },
        { returnRequestId: { in: returnRequestIds } },
        { returnMessageId: { in: returnMessageIds } },
        { disputeId: { in: disputeIds } },
      ],
    },
    select: { id: true, key: true },
  })

  const orderInvoices = await prisma.orderSellerInvoice.findMany({
    where: { OR: [{ orderId: { in: orderIds } }, { sellerId: { in: selectedSellerIds } }] },
    select: { fileKey: true },
  })

  return {
    sellerIds: selectedSellerIds,
    sellerUserIds,
    sellerEmails,
    productIds,
    orderIds,
    supportTicketIds: ids(supportTickets),
    customerSupportTicketIds: ids(customerSupportTickets),
    returnRequestIds,
    returnMessageIds,
    disputeIds,
    couponIds: ids(coupons),
    discountRuleIds: ids(discountRules),
    mediaAssetIds: ids(mediaAssets),
    storageKeys: [...new Set([
      ...mediaAssets.flatMap((asset) => (asset.key ? [asset.key] : [])),
      ...sellers.flatMap((seller) => seller.documents.map((document) => document.fileKey)),
      ...orderInvoices.map((invoice) => invoice.fileKey),
    ])],
  }
}

async function collectPreservedCounts(prisma: DbClient): Promise<Record<string, number>> {
  const [customers, categories, seoRuns, seoGenerations, searches, audits, blogs, slides, promos, settings, bankAccounts] =
    await Promise.all([
      prisma.user.count({ where: { role: 'customer' } }),
      prisma.category.count(),
      prisma.seoContentRun.count(),
      prisma.seoContentGeneration.count(),
      prisma.siteSearchQuery.count(),
      prisma.adminAuditLog.count(),
      prisma.blogPost.count(),
      prisma.homeSlide.count(),
      prisma.homePromo.count(),
      prisma.platformSettings.count(),
      prisma.platformBankAccount.count(),
    ])
  return { customers, categories, seoRuns, seoGenerations, searches, audits, blogs, slides, promos, settings, bankAccounts }
}

async function collectScopeCounts(prisma: DbClient, scope: CleanupScope): Promise<Array<[string, number]>> {
  const [sellers, sellerUsers, products, orders, media, payouts, penalties, ledger, invoices] = await Promise.all([
    prisma.seller.count({ where: { id: { in: scope.sellerIds } } }),
    prisma.user.count({ where: { id: { in: scope.sellerUserIds } } }),
    prisma.product.count({ where: { id: { in: scope.productIds } } }),
    prisma.order.count({ where: { id: { in: scope.orderIds } } }),
    prisma.mediaAsset.count({ where: { id: { in: scope.mediaAssetIds } } }),
    prisma.payout.count({ where: { OR: [{ sellerId: { in: scope.sellerIds } }, { orderId: { in: scope.orderIds } }] } }),
    prisma.penalty.count({ where: { OR: [{ sellerId: { in: scope.sellerIds } }, { orderId: { in: scope.orderIds } }] } }),
    prisma.sellerLedgerEntry.count({ where: { sellerId: { in: scope.sellerIds } } }),
    prisma.sellerInvoice.count({ where: { sellerId: { in: scope.sellerIds } } }),
  ])
  return [
    ['seller', sellers], ['seller user', sellerUsers], ['product', products], ['linked order', orders],
    ['seller/product media', media], ['payout', payouts], ['penalty', penalties],
    ['seller ledger', ledger], ['seller invoice', invoices],
  ]
}

function printCountTable(title: string, rows: Array<[string, number]>): void {
  console.log(`\n${title}`)
  console.log('-'.repeat(48))
  const width = rows.reduce((max, [label]) => Math.max(max, label.length), 0)
  for (const [label, count] of rows) console.log(`  ${label.padEnd(width)}  ${String(count).padStart(9)}`)
}

function push(deleted: Array<[string, number]>, label: string, result: { count: number }): void {
  deleted.push([label, result.count])
}

function assertPreserved(before: Record<string, number>, after: Record<string, number>): void {
  const changed = Object.keys(before).filter((key) => before[key] !== after[key])
  if (changed.length > 0) {
    throw new Error(`Korunmasi gereken kayit sayilari degisti: ${changed.map((key) => `${key} ${before[key]} -> ${after[key]}`).join(', ')}`)
  }
}

async function assertExpectedScope(
  prisma: DbClient,
  scope: CleanupScope,
  expected: CleanupExpectations,
): Promise<void> {
  const totalSellerCount = await prisma.seller.count()
  const actual = {
    sellers: scope.sellerIds.length,
    products: scope.productIds.length,
    orders: scope.orderIds.length,
  }
  const mismatches = (['sellers', 'products', 'orders'] as const)
    .filter((key) => actual[key] !== expected[key])
    .map((key) => `${key}: ${actual[key]} != ${expected[key]}`)
  if (totalSellerCount !== expected.sellers) {
    mismatches.push(`total sellers: ${totalSellerCount} != ${expected.sellers}`)
  }
  if (scope.sellerIds.length !== expected.sellerIds.length) {
    mismatches.push(
      `allowlist seller matches: ${scope.sellerIds.length} != ${expected.sellerIds.length}`,
    )
  }
  if (mismatches.length > 0) {
    throw new Error(`Beklenen temizlik kapsami degisti: ${mismatches.join(', ')}`)
  }
}

export async function performCleanup(
  prisma: PrismaClient,
  options: CleanupExpectations & { deleteStorageObjects?: boolean },
): Promise<CleanupResult> {
  const scope = await buildScope(prisma, options.sellerIds)
  await assertExpectedScope(prisma, scope, options)
  const preservedBefore = await collectPreservedCounts(prisma)
  const deleted: Array<[string, number]> = []

  await prisma.$transaction(async (tx) => {
    const currentScope = await buildScope(tx, options.sellerIds)
    await assertExpectedScope(tx, currentScope, options)
    const adminCredential = await tx.user.findFirst({
      where: { role: 'admin', accounts: { some: { providerId: 'credential', password: { not: null } } } },
      select: { id: true },
    })
    if (!adminCredential) throw new Error('Parola hash bulunan admin credential account zorunludur.')

    const blogs = await tx.blogPost.findMany({ select: { id: true, linkedProductIds: true } })
    for (const blog of blogs) {
      // Legacy blog rows can contain NULL even though the current Prisma field is a list.
      // They have no product links to remove, so leave them untouched.
      if (!Array.isArray(blog.linkedProductIds)) continue
      const linkedProductIds = blog.linkedProductIds.filter((id) => !scope.productIds.includes(id))
      if (linkedProductIds.length !== blog.linkedProductIds.length) {
        await tx.blogPost.update({ where: { id: blog.id }, data: { linkedProductIds } })
      }
    }
    const slides = await tx.homeSlide.findMany({ select: { id: true, ctaHref: true } })
    for (const slide of slides) {
      const safe = sanitizeCmsHref(slide.ctaHref)
      if (!safe.active) await tx.homeSlide.update({ where: { id: slide.id }, data: { ctaHref: safe.href, isActive: false, sellerId: null } })
    }
    const promos = await tx.homePromo.findMany({ select: { id: true, ctaHref: true } })
    for (const promo of promos) {
      const safe = sanitizeCmsHref(promo.ctaHref)
      if (!safe.active) await tx.homePromo.update({ where: { id: promo.id }, data: { ctaHref: safe.href, isActive: false } })
    }
    await tx.homeSlide.updateMany({ where: { sellerId: { in: scope.sellerIds } }, data: { sellerId: null } })

    push(deleted, 'customerSupportMessageAttachment', await tx.customerSupportMessageAttachment.deleteMany({ where: { message: { ticketId: { in: scope.customerSupportTicketIds } } } }))
    push(deleted, 'customerSupportMessage', await tx.customerSupportMessage.deleteMany({ where: { ticketId: { in: scope.customerSupportTicketIds } } }))
    push(deleted, 'customerSupportTicket', await tx.customerSupportTicket.deleteMany({ where: { id: { in: scope.customerSupportTicketIds } } }))
    await tx.customerSupportTicket.updateMany({ where: { resolvedById: { in: scope.sellerUserIds } }, data: { resolvedById: null } })

    push(deleted, 'supportMessageAttachment', await tx.supportMessageAttachment.deleteMany({ where: { message: { ticketId: { in: scope.supportTicketIds } } } }))
    push(deleted, 'supportMessage', await tx.supportMessage.deleteMany({ where: { ticketId: { in: scope.supportTicketIds } } }))
    push(deleted, 'supportTicket', await tx.supportTicket.deleteMany({ where: { id: { in: scope.supportTicketIds } } }))

    push(deleted, 'mediaAsset', await tx.mediaAsset.deleteMany({
      where: {
        id: { in: scope.mediaAssetIds },
        homeSlideMedia: { none: {} }, homeSlidePoster: { none: {} }, homePromoMedia: { none: {} },
        supportAttachments: { none: {} }, customerSupportAttachments: { none: {} },
      },
    }))
    push(deleted, 'returnMessage', await tx.returnMessage.deleteMany({ where: { returnRequestId: { in: scope.returnRequestIds } } }))
    push(deleted, 'returnRequest', await tx.returnRequest.deleteMany({ where: { id: { in: scope.returnRequestIds } } }))
    push(deleted, 'disputeMessage', await tx.disputeMessage.deleteMany({ where: { disputeId: { in: scope.disputeIds } } }))
    push(deleted, 'dispute', await tx.dispute.deleteMany({ where: { id: { in: scope.disputeIds } } }))

    push(deleted, 'sellerInvoice', await tx.sellerInvoice.deleteMany({ where: { sellerId: { in: scope.sellerIds } } }))
    push(deleted, 'payout', await tx.payout.deleteMany({ where: { OR: [{ sellerId: { in: scope.sellerIds } }, { orderId: { in: scope.orderIds } }] } }))
    push(deleted, 'orphan payoutBatch', await tx.payoutBatch.deleteMany({ where: { payouts: { none: {} } } }))
    push(deleted, 'penalty', await tx.penalty.deleteMany({ where: { OR: [{ sellerId: { in: scope.sellerIds } }, { orderId: { in: scope.orderIds } }] } }))
    push(deleted, 'sellerLedgerEntry', await tx.sellerLedgerEntry.deleteMany({ where: { sellerId: { in: scope.sellerIds } } }))

    push(deleted, 'paymentEvent', await tx.paymentEvent.deleteMany({ where: { payment: { orderId: { in: scope.orderIds } } } }))
    push(deleted, 'payment', await tx.payment.deleteMany({ where: { orderId: { in: scope.orderIds } } }))
    push(deleted, 'shipmentEvent', await tx.shipmentEvent.deleteMany({ where: { shipment: { orderId: { in: scope.orderIds } } } }))
    push(deleted, 'shipment', await tx.shipment.deleteMany({ where: { orderId: { in: scope.orderIds } } }))
    push(deleted, 'orderStatusHistory', await tx.orderStatusHistory.deleteMany({ where: { orderId: { in: scope.orderIds } } }))
    push(deleted, 'fulfillmentRisk', await tx.fulfillmentRisk.deleteMany({ where: { orderId: { in: scope.orderIds } } }))
    push(deleted, 'fulfillmentExtensionRequest', await tx.fulfillmentExtensionRequest.deleteMany({ where: { OR: [{ orderId: { in: scope.orderIds } }, { sellerId: { in: scope.sellerIds } }, { customerId: { in: scope.sellerUserIds } }] } }))
    push(deleted, 'orderSellerInvoice', await tx.orderSellerInvoice.deleteMany({ where: { OR: [{ orderId: { in: scope.orderIds } }, { sellerId: { in: scope.sellerIds } }] } }))
    push(deleted, 'orderEmailAlias', await tx.orderEmailAlias.deleteMany({ where: { OR: [{ orderId: { in: scope.orderIds } }, { sellerId: { in: scope.sellerIds } }] } }))
    push(deleted, 'inboundEmail', await tx.inboundEmail.deleteMany({ where: { OR: [{ orderId: { in: scope.orderIds } }, { sellerId: { in: scope.sellerIds } }] } }))
    push(deleted, 'orderLegalSnapshot', await tx.orderLegalSnapshot.deleteMany({ where: { orderId: { in: scope.orderIds } } }))
    push(deleted, 'couponUsage', await tx.couponUsage.deleteMany({ where: { OR: [{ orderId: { in: scope.orderIds } }, { couponId: { in: scope.couponIds } }, { userId: { in: scope.sellerUserIds } }] } }))
    push(deleted, 'productReview', await tx.productReview.deleteMany({ where: { OR: [{ orderId: { in: scope.orderIds } }, { productId: { in: scope.productIds } }, { customerId: { in: scope.sellerUserIds } }] } }))
    push(deleted, 'orderLine', await tx.orderLine.deleteMany({ where: { orderId: { in: scope.orderIds } } }))
    push(deleted, 'order', await tx.order.deleteMany({ where: { id: { in: scope.orderIds } } }))

    push(deleted, 'cartItem', await tx.cartItem.deleteMany({ where: { productId: { in: scope.productIds } } }))
    push(deleted, 'favoriteProduct', await tx.favoriteProduct.deleteMany({ where: { OR: [{ productId: { in: scope.productIds } }, { userId: { in: scope.sellerUserIds } }] } }))
    push(deleted, 'productAnalyticsEvent', await tx.productAnalyticsEvent.deleteMany({ where: { OR: [{ productId: { in: scope.productIds } }, { sellerId: { in: scope.sellerIds } }, { userId: { in: scope.sellerUserIds } }] } }))
    push(deleted, 'storeFollow', await tx.storeFollow.deleteMany({ where: { OR: [{ sellerId: { in: scope.sellerIds } }, { userId: { in: scope.sellerUserIds } }] } }))
    push(deleted, 'storeDiscountDispatch', await tx.storeDiscountDispatch.deleteMany({ where: { OR: [{ sellerId: { in: scope.sellerIds } }, { userId: { in: scope.sellerUserIds } }] } }))
    push(deleted, 'coupon', await tx.coupon.deleteMany({ where: { id: { in: scope.couponIds } } }))
    push(deleted, 'discountRuleProduct', await tx.discountRuleProduct.deleteMany({ where: { discountRuleId: { in: scope.discountRuleIds } } }))
    push(deleted, 'discountRule', await tx.discountRule.deleteMany({ where: { id: { in: scope.discountRuleIds } } }))
    push(deleted, 'product', await tx.product.deleteMany({ where: { id: { in: scope.productIds } } }))

    push(deleted, 'sellerBankDetailHistory', await tx.sellerBankDetailHistory.deleteMany({ where: { sellerId: { in: scope.sellerIds } } }))
    push(deleted, 'sellerBankDetail', await tx.sellerBankDetail.deleteMany({ where: { sellerId: { in: scope.sellerIds } } }))
    push(deleted, 'sellerDocument', await tx.sellerDocument.deleteMany({ where: { sellerId: { in: scope.sellerIds } } }))
    push(deleted, 'sellerProfile', await tx.sellerProfile.deleteMany({ where: { sellerId: { in: scope.sellerIds } } }))
    push(deleted, 'seller', await tx.seller.deleteMany({ where: { id: { in: scope.sellerIds } } }))

    push(deleted, 'notification', await tx.notification.deleteMany({ where: { userId: { in: scope.sellerUserIds } } }))
    const sellerCarts = await tx.cart.findMany({ where: { userId: { in: scope.sellerUserIds } }, select: { id: true } })
    push(deleted, 'seller cartItem', await tx.cartItem.deleteMany({ where: { cartId: { in: ids(sellerCarts) } } }))
    push(deleted, 'seller cart', await tx.cart.deleteMany({ where: { id: { in: ids(sellerCarts) } } }))
    push(deleted, 'seller address', await tx.address.deleteMany({ where: { userId: { in: scope.sellerUserIds } } }))
    push(deleted, 'seller session', await tx.session.deleteMany({ where: { userId: { in: scope.sellerUserIds } } }))
    push(deleted, 'seller account', await tx.account.deleteMany({ where: { userId: { in: scope.sellerUserIds } } }))
    push(deleted, 'seller verification', await tx.verification.deleteMany({ where: { identifier: { in: scope.sellerEmails } } }))
    push(deleted, 'seller user', await tx.user.deleteMany({ where: { id: { in: scope.sellerUserIds } } }))

    const scopeAfter = await collectScopeCounts(tx, scope)
    const leftovers = scopeAfter.filter(([, count]) => count > 0)
    if (leftovers.length > 0) throw new Error(`Temizlik dogrulamasi basarisiz: ${leftovers.map(([label, count]) => `${label}=${count}`).join(', ')}`)
    assertPreserved(preservedBefore, await collectPreservedCounts(tx))
  }, { timeout: 10 * 60 * 1000, maxWait: 60 * 1000 })

  const failedStorageKeys: string[] = []
  if (options.deleteStorageObjects) {
    for (const key of scope.storageKeys) {
      try { await deleteObject(key) } catch { failedStorageKeys.push(key) }
    }
  }
  return { deleted, failedStorageKeys }
}

async function main() {
  const mode = parseMode(process.argv.slice(2))
  if (!mode) { printUsage(); process.exit(1) }
  loadDotEnv({ path: path.join(repoRoot, '.env') })
  const databaseUrl = process.env.DATABASE_URL?.trim()
  if (!databaseUrl) { console.error('DATABASE_URL tanimli degil.'); process.exit(1) }
  const databaseName = databaseNameFromUrl(databaseUrl)
  if (mode.kind === 'confirm' && mode.databaseName !== databaseName) {
    console.error(`Yazili onay eslesmiyor. Beklenen: --confirm=${databaseName}`)
    process.exit(1)
  }
  console.log(`\nMod: ${mode.kind === 'dry-run' ? 'DRY-RUN' : 'CONFIRM'}`)
  console.log(`Hedef: ${describeTarget(databaseUrl)}`)
  const prisma = new PrismaClient()
  try {
    await prisma.$connect()
    const adminCredential = await prisma.user.findFirst({
      where: { role: 'admin', accounts: { some: { providerId: 'credential', password: { not: null } } } },
      select: { id: true },
    })
    if (!adminCredential) throw new Error('Parola hash bulunan admin credential account zorunludur.')
    const scope = await buildScope(prisma, mode.sellerIds)
    await assertExpectedScope(prisma, scope, mode)
    printCountTable('SILINECEK DAR KAPSAM', await collectScopeCounts(prisma, scope))
    printCountTable('KORUNACAK SAYILAR', Object.entries(await collectPreservedCounts(prisma)))
    if (mode.kind === 'dry-run') { console.log('\nDRY-RUN tamamlandi; veri degismedi.\n'); return }
    const result = await performCleanup(prisma, {
      sellerIds: mode.sellerIds,
      sellers: mode.sellers,
      products: mode.products,
      orders: mode.orders,
      deleteStorageObjects: true,
    })
    printCountTable('SILINEN KAYITLAR', result.deleted)
    if (result.failedStorageKeys.length > 0) {
      console.error(`\nDB temizlendi ancak ${result.failedStorageKeys.length} R2 nesnesi silinemedi.`)
      process.exitCode = 1
      return
    }
    console.log('\nOK - satici, urun ve bagli demo verisi temizlendi; korunacak veriler degismedi.\n')
  } catch (error) {
    console.error(`\nFAIL - ${String(error)}\n`)
    process.exitCode = 1
  } finally {
    await prisma.$disconnect()
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main()
