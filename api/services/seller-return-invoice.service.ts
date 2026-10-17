import { Prisma, type PrismaClient, type SellerReturnInvoice } from '@prisma/client'
import { isPendingReturnInspection } from '../domain/communication-audience'
import { Decimal } from '@prisma/client/runtime/client'
import { roundMoney } from '@hanuja/security/money'
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../lib/errors'
import {
  assertInvoiceRevision,
  getInvoiceRevision,
  validateInvoiceReason,
} from '../lib/invoice-management'
import {
  createPrivateDocumentStorage,
  type PrivateDocumentStorage,
} from '../lib/private-document-storage'
import { DOCUMENT_MAX_SIZE_BYTES } from '../lib/r2'
import { formatOrderNumber } from '../lib/order-number'
import { getSellerPanelUrl } from '../lib/platform-info'
import { getReportingDateKey, isReportingDateKey } from '../lib/reporting-time'
import {
  splitVatInclusiveAmount,
  calculateSellerPurchaseInvoice,
} from '../domain/seller-purchase-invoice'
import { recordNotification } from './notification-outbox.service'
import {
  schedulePrivateDocumentCleanup,
  processPrivateDocumentCleanup,
} from './private-document-cleanup.service'

type Db = PrismaClient | Prisma.TransactionClient
type InvoiceIdentity = { returnRequestId: string; sellerId: string }
type AdminIdentity = InvoiceIdentity & {
  actorId: string
  expectedRevision?: string | null
  reason?: string | null
}
type InvoiceMetadata = { invoiceNumber: string; invoiceDate: string }

function revisionSource(invoice: SellerReturnInvoice) {
  return {
    id: invoice.id,
    fileKey: `${invoice.fileKey}\0${invoice.invoiceNumber}\0${invoice.invoiceDate.toISOString()}`,
  }
}
function summary(invoice: SellerReturnInvoice | null) {
  if (!invoice) return null
  const { fileKey: _key, uploadedByAdminId: _admin, refundIds: _refunds, ...safe } = invoice
  return { ...safe, revision: getInvoiceRevision(revisionSource(invoice)) }
}
function metadata(input: InvoiceMetadata) {
  const invoiceNumber = input.invoiceNumber.trim()
  if (!/^[\p{L}\p{N} ._/-]{1,64}$/u.test(invoiceNumber))
    throw new ValidationError('Geçerli bir fatura numarası girin.')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.invoiceDate))
    throw new ValidationError('Fatura tarihi YYYY-MM-DD olmalıdır.')
  // A Türkiye calendar day, as in the purchase invoice approval: today is valid at any hour.
  if (!isReportingDateKey(input.invoiceDate) || input.invoiceDate > getReportingDateKey(new Date()))
    throw new ValidationError('Fatura tarihi geçerli olmalı ve ileri tarih olmamalıdır.')
  // 09:00Z is the same calendar day in UTC and Istanbul; the admin card reads the ISO date part.
  return { invoiceNumber, invoiceDate: new Date(input.invoiceDate + 'T09:00:00.000Z') }
}

export function createSellerReturnInvoiceService({
  prisma,
  storage: supplied,
}: {
  prisma: PrismaClient
  storage?: PrivateDocumentStorage
}) {
  let documentStorage = supplied
  const storage = () => (documentStorage ??= createPrivateDocumentStorage())
  const where = ({ returnRequestId, sellerId }: InvoiceIdentity) => ({
    returnRequestId_sellerId: { returnRequestId, sellerId },
  })
  async function admin(db: Db, actorId: string) {
    const actor = await db.user.findUnique({
      where: { id: actorId },
      select: { role: true },
    })
    if (actor?.role !== 'admin') throw new ForbiddenError('Admin yetkisi gerekli')
  }
  async function context(db: Db, identity: InvoiceIdentity) {
    const rr = await db.returnRequest.findFirst({
      where: {
        id: identity.returnRequestId,
        OR: [
          { sellerId: identity.sellerId },
          {
            sellerId: null,
            order: { lines: { some: { sellerId: identity.sellerId } } },
          },
        ],
      },
      include: {
        order: {
          include: { lines: { where: { sellerId: identity.sellerId } } },
        },
      },
    })
    if (!rr) throw new NotFoundError('İade')
    const refunds = await db.refundTransaction.findMany({
      where: {
        orderId: rr.orderId,
        sellerId: identity.sellerId,
        OR: [
          { sourceType: 'return_request', sourceId: rr.id },
          ...(rr.disputeId ? [{ sourceType: 'dispute' as const, sourceId: rr.disputeId }] : []),
        ],
      },
      include: { items: { include: { orderLine: true } } },
    })
    const purchase = await db.orderSellerInvoice.findUnique({
      where: {
        orderId_sellerId: { orderId: rr.orderId, sellerId: identity.sellerId },
      },
    })
    const amount = refunds.reduce((sum, r) => sum.add(r.sellerAdjustmentAmount), new Decimal(0))
    const finalDecision =
      rr.status === 'refund_completed' ||
      (rr.status === 'rejected' && Boolean(rr.reviewedAt) && !isPendingReturnInspection(rr))
    const ready =
      finalDecision &&
      refunds.length > 0 &&
      refunds.every((r) => r.status === 'completed' && r.ledgerAppliedAt) &&
      purchase?.reviewStatus === 'approved' &&
      amount.gt(0)
    // Allocate the existing seller adjustment over returned units and their original tax rates.
    // This is a document summary, never a new accounting transaction.
    const purchaseLines = calculateSellerPurchaseInvoice(rr.order.lines).lines
    const groups = new Map<string, Decimal>()
    for (const refund of refunds) {
      const products = refund.items.filter(
        (item) => item.kind === 'product' && item.orderLine && item.quantity,
      )
      const weights = products.map((item) => {
        const line = purchaseLines.find((line) => line.orderLineId === item.orderLineId)
        return line ? line.invoiceAmount.div(line.quantity).mul(item.quantity!) : new Decimal(0)
      })
      const totalWeight = weights.reduce((sum, value) => sum.add(value), new Decimal(0))
      let allocated = new Decimal(0)
      products.forEach((item, i) => {
        if (totalWeight.lte(0)) return
        const share =
          i === products.length - 1
            ? refund.sellerAdjustmentAmount.sub(allocated)
            : roundMoney(refund.sellerAdjustmentAmount.mul(weights[i]!).div(totalWeight))
        allocated = allocated.add(share)
        const rate = item.orderLine!.taxRate.toFixed(4)
        groups.set(rate, (groups.get(rate) ?? new Decimal(0)).add(share))
      })
    }
    const vatGroups = [...groups].map(([rate, gross]) => {
      const split = splitVatInclusiveAmount(gross, new Decimal(rate))
      return {
        taxRate: rate,
        amount: gross.toFixed(2),
        netAmount: split.netAmount.toFixed(2),
        vatAmount: split.vatAmount.toFixed(2),
      }
    })
    const total = vatGroups.reduce((sum, group) => sum.add(group.amount), new Decimal(0))
    return {
      rr,
      refunds,
      amount,
      vatGroups,
      ready: Boolean(ready && total.equals(amount)),
      message: !ready
        ? 'Para iadesi tamamlanmalı, alış faturası onaylı ve mali kayıtlar kesinleşmiş olmalıdır.'
        : !total.equals(amount)
          ? 'KDV dökümü için mali eşleşme incelenmelidir.'
          : null,
    }
  }
  async function cleanup(key: string) {
    await processPrivateDocumentCleanup({
      prisma,
      fileKey: key,
      deleteFile: (k) => storage().delete(k),
    })
  }
  async function locked<T>(
    input: InvoiceIdentity,
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ) {
    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM orders WHERE id = (SELECT "orderId" FROM return_requests WHERE id = ${input.returnRequestId}) FOR UPDATE`
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`return-invoice:${input.returnRequestId}:${input.sellerId}`}, 0))`
      return fn(tx)
    })
  }
  async function getForAdmin(input: InvoiceIdentity & { actorId: string }) {
    await admin(prisma, input.actorId)
    const finance = await context(prisma, input)
    const invoice = await prisma.sellerReturnInvoice.findUnique({
      where: where(input),
    })
    return {
      invoice: summary(invoice),
      ready: finance.ready,
      message: finance.message,
      amount: finance.amount.toFixed(2),
      vatGroups: finance.vatGroups,
    }
  }
  async function getForSeller(input: InvoiceIdentity) {
    await context(prisma, input)
    return summary(await prisma.sellerReturnInvoice.findUnique({ where: where(input) }))
  }
  async function upload(
    input: AdminIdentity &
      InvoiceMetadata & {
        fileName: string
        mimeType: string
        body: Uint8Array
      },
  ) {
    await admin(prisma, input.actorId)
    const values = metadata(input)
    if (
      input.mimeType !== 'application/pdf' ||
      Buffer.from(input.body.subarray(0, 5)).toString('ascii') !== '%PDF-' ||
      input.body.byteLength > DOCUMENT_MAX_SIZE_BYTES
    )
      throw new ValidationError('En fazla 20 MB geçerli bir PDF yükleyin.')
    const uploaded = await storage().write(input.body)
    let obsolete: string | null = null
    try {
      const invoice = await locked(input, async (tx) => {
        await admin(tx, input.actorId)
        const finance = await context(tx, input)
        if (!finance.ready)
          throw new ConflictError(finance.message ?? 'İade faturası henüz yüklenemez.')
        const current = await tx.sellerReturnInvoice.findUnique({
          where: where(input),
        })
        assertInvoiceRevision(current ? revisionSource(current) : null, input.expectedRevision)
        const reason = current
          ? validateInvoiceReason(input.reason)
          : 'Hanuja iade faturası yüklendi.'
        const data = {
          ...values,
          orderId: finance.rr.orderId,
          amount: finance.amount,
          refundIds: finance.refunds.map((r) => r.id),
          vatGroups: finance.vatGroups,
          fileKey: uploaded.key,
          fileName: input.fileName,
          mimeType: input.mimeType,
          sizeBytes: input.body.byteLength,
          uploadedByAdminId: input.actorId,
          uploadedAt: new Date(),
        }
        const saved = await tx.sellerReturnInvoice.upsert({
          where: where(input),
          create: {
            returnRequestId: input.returnRequestId,
            sellerId: input.sellerId,
            ...data,
          },
          update: data,
        })
        if (current) {
          obsolete = current.fileKey
          await schedulePrivateDocumentCleanup(tx, obsolete)
        }
        await tx.adminAuditLog.create({
          data: {
            actorId: input.actorId,
            actionType: current ? 'order_invoice_replaced' : 'order_invoice_uploaded',
            targetType: 'return_request',
            targetId: input.returnRequestId,
            reason,
            newData: {
              invoiceId: saved.id,
              invoiceNumber: saved.invoiceNumber,
              direction: 'hanuja_to_seller',
              refundIds: data.refundIds,
              amount: data.amount.toFixed(2),
            },
          },
        })
        const seller = await tx.seller.findUniqueOrThrow({
          where: { id: input.sellerId },
          select: { userId: true, user: { select: { email: true } } },
        })
        await recordNotification(tx, {
          eventKey: `seller-return-invoice:${saved.id}:${getInvoiceRevision(saved)}`,
          userId: seller.userId,
          emailTo: seller.user.email,
          type: 'seller_return_invoice_uploaded',
          title: 'Hanuja iade faturası hazır',
          body: 'İade faturanızı panelden görüntüleyebilirsiniz.',
          data: {
            returnRequestId: input.returnRequestId,
            sellerId: input.sellerId,
            orderId: saved.orderId,
            orderNumber: formatOrderNumber(finance.rr.order.publicNumber, saved.orderId),
            panelUrl: getSellerPanelUrl() + '/iadeler/' + input.returnRequestId,
          },
        })
        return summary(saved)
      })
      if (obsolete) await cleanup(obsolete)
      return invoice
    } catch (error) {
      await schedulePrivateDocumentCleanup(prisma, uploaded.key)
      await cleanup(uploaded.key)
      throw error
    }
  }
  async function update(input: AdminIdentity & InvoiceMetadata) {
    return locked(input, async (tx) => {
      await admin(tx, input.actorId)
      await context(tx, input)
      const current = await tx.sellerReturnInvoice.findUnique({
        where: where(input),
      })
      if (!current) throw new NotFoundError('Fatura')
      assertInvoiceRevision(revisionSource(current), input.expectedRevision)
      const reason = validateInvoiceReason(input.reason)
      const saved = await tx.sellerReturnInvoice.update({
        where: where(input),
        data: metadata(input),
      })
      await tx.adminAuditLog.create({
        data: {
          actorId: input.actorId,
          actionType: 'order_invoice_replaced',
          targetType: 'return_request',
          targetId: input.returnRequestId,
          reason,
          previousData: {
            invoiceNumber: current.invoiceNumber,
            invoiceDate: current.invoiceDate.toISOString(),
          },
          newData: {
            invoiceNumber: saved.invoiceNumber,
            invoiceDate: saved.invoiceDate.toISOString(),
            metadataOnly: true,
          },
        },
      })
      return summary(saved)
    })
  }
  async function remove(input: AdminIdentity) {
    const removed = await locked(input, async (tx) => {
      await admin(tx, input.actorId)
      const current = await tx.sellerReturnInvoice.findUnique({
        where: where(input),
      })
      if (!current) throw new NotFoundError('Fatura')
      assertInvoiceRevision(revisionSource(current), input.expectedRevision)
      const reason = validateInvoiceReason(input.reason)
      await tx.sellerReturnInvoice.delete({ where: where(input) })
      await schedulePrivateDocumentCleanup(tx, current.fileKey)
      await tx.adminAuditLog.create({
        data: {
          actorId: input.actorId,
          actionType: 'order_invoice_removed',
          targetType: 'return_request',
          targetId: input.returnRequestId,
          reason,
          previousData: {
            invoiceId: current.id,
            invoiceNumber: current.invoiceNumber,
          },
        },
      })
      return current
    })
    await cleanup(removed.fileKey)
    return { removed: true }
  }
  async function read(input: InvoiceIdentity) {
    await context(prisma, input)
    const invoice = await prisma.sellerReturnInvoice.findUnique({
      where: where(input),
    })
    if (!invoice) throw new NotFoundError('Fatura')
    return {
      body: await storage().read(invoice.fileKey),
      fileName: invoice.fileName,
      mimeType: invoice.mimeType,
      sizeBytes: invoice.sizeBytes,
    }
  }
  return { getForAdmin, getForSeller, upload, update, remove, read }
}
