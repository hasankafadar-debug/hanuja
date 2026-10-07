import { config } from 'dotenv'
import { PrismaClient } from '@prisma/client'
import { createOrderDocumentService, isInvoiceAliasingEnabled } from '../../api/services/order-document.service'
import { SELLER_VISIBLE_PAYMENT_WHERE } from '../../api/repositories/order.repository'

config()

const apply = process.argv.includes('--apply')
const orderArgument = process.argv.find(arg => arg.startsWith('--order='))
const orderId = orderArgument?.slice('--order='.length)
const prisma = new PrismaClient()

async function main() {
  if (orderArgument && !orderId) throw new Error('--order must contain an order ID.')
  if (apply && !isInvoiceAliasingEnabled()) throw new Error('Invoice aliasing is disabled; refusing backfill.')
  const documents = createOrderDocumentService({ prisma })
  let cursor: string | undefined
  let missing = 0
  let completed = 0
  while (true) {
    const orders = await prisma.order.findMany({
      where: {
        ...(orderId ? { id: orderId } : {}),
        AND: [SELLER_VISIBLE_PAYMENT_WHERE],
        status: { notIn: ['draft', 'checkout_started', 'payment_pending', 'payment_failed', 'payment_cancelled', 'bank_transfer_waiting'] },
      },
      select: {
        id: true,
        lines: { select: { sellerId: true } },
        emailAliases: { where: { purpose: 'invoice' }, select: { sellerId: true } },
      },
      orderBy: { id: 'asc' },
      take: 100,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    })
    if (!orders.length) break
    for (const order of orders) {
      const existing = new Set(order.emailAliases.map(alias => alias.sellerId))
      const sellerIds = [...new Set(order.lines.map(line => line.sellerId))].filter(id => !existing.has(id))
      missing += sellerIds.length
      if (apply) {
        for (const sellerId of sellerIds) {
          await documents.ensureInvoiceAliasForSeller(order.id, sellerId)
          completed += 1
        }
      }
    }
    cursor = orders.at(-1)!.id
  }
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', missing, completed }))
}

main().catch(error => {
  console.error('Invoice alias backfill failed', { code: error?.code ?? 'UNKNOWN' })
  process.exitCode = 1
}).finally(() => prisma.$disconnect())
