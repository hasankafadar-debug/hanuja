/**
 * Satıcı fatura hatırlatması — satıcı Hanuja modeli.
 *
 * Satıcı faturayı ürünü kargoya verirken Hanuja'ya keser. Kargo girişi bu yüzden
 * engellenmez; fatura kargo girişinden bir saat sonra hâlâ yoksa satıcıya tek seferlik
 * hatırlatma e-postası gider (ceza yok). Bir saatlik pay, faturanın e-postayla birkaç
 * dakika geç düşmesinin gereksiz uyarı üretmemesi içindir. Hatırlatma sipariş/satıcı
 * başına bir kez yazılır: outbox `(userId, type, eventKey)` tekilliği tekrarları yutar.
 */
import type { PrismaClient } from '@prisma/client'
import type { NotificationDispatchJobData } from '../jobs/notification-dispatch.job'
import { formatOrderNumber } from '../lib/order-number'
import { getSellerOrderUrl } from '../lib/platform-info'
import { recordNotifications } from './notification-outbox.service'

export const SELLER_INVOICE_REMINDER_DELAY_MS = 60 * 60 * 1000
// Older shipments are outside the reminder window (e.g. the first run after deploy).
const REMINDER_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000
const PAGE_SIZE = 500

export async function sweepSellerInvoiceReminders(params: { prisma: PrismaClient; now?: Date }) {
  const { prisma } = params
  const now = params.now ?? new Date()
  let cursor: string | undefined
  let candidates = 0
  let reminded = 0

  // Every shipment in the window is visited each run, page by page, so a busy week
  // cannot starve later shipments behind ones that were already reminded or invoiced.
  for (;;) {
    const shipments = await prisma.shipment.findMany({
      where: {
        handedAt: {
          lte: new Date(now.getTime() - SELLER_INVOICE_REMINDER_DELAY_MS),
          gte: new Date(now.getTime() - REMINDER_LOOKBACK_MS),
        },
      },
      select: {
        id: true,
        orderId: true,
        sellerId: true,
        order: { select: { publicNumber: true } },
        seller: { select: { userId: true, displayName: true, user: { select: { email: true } } } },
      },
      orderBy: { id: 'asc' },
      take: PAGE_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    })
    if (!shipments.length) break
    candidates += shipments.length

    const invoices = await prisma.orderSellerInvoice.findMany({
      where: { OR: shipments.map((shipment) => ({ orderId: shipment.orderId, sellerId: shipment.sellerId })) },
      select: { orderId: true, sellerId: true },
    })
    const invoiced = new Set(invoices.map((invoice) => `${invoice.orderId}:${invoice.sellerId}`))

    const reminders: NotificationDispatchJobData[] = shipments
      .filter((shipment) => !invoiced.has(`${shipment.orderId}:${shipment.sellerId}`))
      .map((shipment) => {
        const orderNumber = formatOrderNumber(shipment.order.publicNumber, shipment.orderId)
        return {
          eventKey: `seller-invoice-reminder:${shipment.orderId}:${shipment.sellerId}`,
          userId: shipment.seller.userId,
          type: 'seller_invoice_reminder',
          title: "Hanuja'ya fatura bekleniyor",
          body: `#${orderNumber} numaralı sipariş için Hanuja'ya kestiğiniz fatura bekleniyor.`,
          data: {
            orderId: shipment.orderId,
            sellerId: shipment.sellerId,
            sellerName: shipment.seller.displayName,
            orderNumber,
            panelUrl: getSellerOrderUrl(shipment.orderId),
          },
          ...(shipment.seller.user.email ? { emailTo: shipment.seller.user.email } : {}),
        }
      })
    // Counts only new rows: a reminder already written for this order/seller is skipped.
    reminded += (await recordNotifications(prisma, reminders)).count

    if (shipments.length < PAGE_SIZE) break
    cursor = shipments[shipments.length - 1]!.id
  }
  return { candidates, reminded }
}
