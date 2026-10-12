import { randomUUID } from 'node:crypto'
import type { PrismaClient } from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/client'
import { ConflictError, NotFoundError, ValidationError } from '../lib/errors'
import { lockSellerFinance } from '../lib/seller-finance-lock'
import { syncSellerPayoutBatches } from '../lib/payout-batch-totals'
import { createSellerLedgerRepository } from '../repositories/seller-ledger.repository'
import { createAdminAuditLogRepository } from '../repositories/admin-audit-log.repository'

function validateTotal(total: Decimal) {
  if (!total.isFinite() || total.lte(0) || total.decimalPlaces() > 2 || total.gt('9999999999.99')) {
    throw new ValidationError('Fatura toplamı pozitif ve en fazla iki ondalıklı olmalı.')
  }
}

function validateDate(date: Date) {
  if (!Number.isFinite(date.getTime())) throw new ValidationError('Geçerli bir fatura tarihi girin.')
  const day = (value: Date) => value.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' })
  if (day(date) > day(new Date())) throw new ValidationError('Fatura tarihi ileri bir gün olamaz.')
}

function accountingDate(date: Date) {
  // The input is a calendar date, so today's debt must take effect at the
  // beginning of that day in Istanbul, rather than waiting until noon.
  validateDate(date)
  return new Date(`${date.toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' })}T00:00:00+03:00`)
}

function invoiceDescription(value: string | null | undefined) {
  const description = value?.trim()
  if (!description || description.length > 5000) throw new ValidationError('Fatura açıklaması gerekli; en fazla 5000 karakter girin.')
  return description
}

export function createAdditionalSellerInvoiceService({ prisma }: { prisma: PrismaClient }) {
  const ledger = createSellerLedgerRepository(prisma)
  return {
    async create(params: {
      sellerId: string; invoiceNumber: string; invoiceDate: Date; description?: string | null
      invoiceCategory?: string | null; grossInvoiceAmount?: Decimal; createdByAdminId: string
    }) {
      const invoiceNumber = params.invoiceNumber.trim()
      if (!invoiceNumber || invoiceNumber.length > 120) throw new ValidationError('Fatura numarası gerekli; en fazla 120 karakter girin.')
      const description = invoiceDescription(params.description)
      const total = params.grossInvoiceAmount
      if (!total) throw new ValidationError('KDV dahil fatura toplamı gerekli.')
      validateTotal(total)
      const invoiceDate = accountingDate(params.invoiceDate)
      try {
        return await prisma.$transaction(async (tx) => {
          await lockSellerFinance(tx, [params.sellerId])
          const seller = await tx.seller.findUnique({ where: { id: params.sellerId }, select: { id: true } })
          if (!seller) throw new NotFoundError('Seller', params.sellerId)
          if (await tx.sellerInvoice.findUnique({ where: { invoiceNumber }, select: { id: true } })) {
            throw new ConflictError('Bu fatura numarası zaten kayıtlı.')
          }
          // This is a gross-total account posting. The externally issued invoice
          // remains the tax document; no VAT split is inferred from its total.
          const invoice = await tx.sellerInvoice.create({ data: {
            sellerId: params.sellerId, type: 'additional', invoiceNumber, invoiceDate,
            description, invoiceCategory: params.invoiceCategory ?? null,
            amount: total, vatRate: 0, vatAmount: 0, grossInvoiceAmount: total,
            createdByAdminId: params.createdByAdminId,
          } })
          await ledger.createEntry({
            sellerId: params.sellerId, type: 'manual_adjustment', amount: total.negated(),
            eventKey: `seller-invoice:principal:${invoice.id}`,
            referenceType: 'seller_invoice', referenceId: invoice.id,
            effectiveAt: invoiceDate, description,
            createdBy: params.createdByAdminId, visibleToSeller: true,
          }, tx)
          await createAdminAuditLogRepository(tx).createEntry({
            actorId: params.createdByAdminId, actionType: 'manual_ledger_adjustment',
            targetType: 'seller_invoice', targetId: invoice.id,
            newData: { sellerId: invoice.sellerId, invoiceNumber, invoiceDate: invoice.invoiceDate.toISOString(),
              grossInvoiceAmount: total.toFixed(2), description }, reason: description,
          })
          await syncSellerPayoutBatches(tx, params.sellerId)
          return invoice
        })
      } catch (error) {
        if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') {
          throw new ConflictError('Bu fatura numarası zaten kayıtlı.')
        }
        throw error
      }
    },

    async update(params: {
      invoiceId: string; adminActorId: string; invoiceDate?: Date; description?: string | null
      invoiceCategory?: string | null; grossInvoiceAmount?: Decimal
    }) {
      const identity = await prisma.sellerInvoice.findUnique({ where: { id: params.invoiceId }, select: { sellerId: true } })
      if (!identity) throw new NotFoundError('SellerInvoice', params.invoiceId)
      return prisma.$transaction(async (tx) => {
        await lockSellerFinance(tx, [identity.sellerId])
        const current = await tx.sellerInvoice.findUnique({ where: { id: params.invoiceId } })
        if (!current || current.type !== 'additional') throw new ValidationError('Ek fatura bulunamadı.')
        const settled = await tx.payoutDebtOffset.findFirst({ where: {
          ledgerEntry: { sellerId: current.sellerId, referenceType: 'seller_invoice', referenceId: current.id },
        }, select: { id: true } })
        if (settled || current.payoutId) throw new ValidationError('Hakedişten kesilmiş fatura düzenlenemez.')
        const total = params.grossInvoiceAmount ?? current.grossInvoiceAmount
        const date = accountingDate(params.invoiceDate ?? current.invoiceDate)
        const description = invoiceDescription(params.description !== undefined ? params.description : current.description)
        validateTotal(total)
        const revision = randomUUID()
        if (!total.equals(current.grossInvoiceAmount) || date.getTime() !== current.invoiceDate.getTime()) {
          // Move the financial effect with append-only reversals, including a
          // changed invoice date. Both rows keep the same debt source group.
          await ledger.createEntry({
            sellerId: current.sellerId, type: 'manual_adjustment', amount: current.grossInvoiceAmount,
            eventKey: `seller-invoice:correction:${current.id}:${revision}:credit`,
            referenceType: 'seller_invoice', referenceId: current.id, effectiveAt: current.invoiceDate,
            description: `Ek fatura düzeltmesi: ${description}`, createdBy: params.adminActorId, visibleToSeller: true,
          }, tx)
          await ledger.createEntry({
            sellerId: current.sellerId, type: 'manual_adjustment', amount: total.negated(),
            eventKey: `seller-invoice:correction:${current.id}:${revision}:debit`,
            referenceType: 'seller_invoice', referenceId: current.id, effectiveAt: date,
            description, createdBy: params.adminActorId, visibleToSeller: true,
          }, tx)
        }
        const updated = await tx.sellerInvoice.update({ where: { id: current.id }, data: {
          amount: total, grossInvoiceAmount: total, invoiceDate: date, description,
          ...(params.invoiceCategory !== undefined ? { invoiceCategory: params.invoiceCategory } : {}),
        } })
        await createAdminAuditLogRepository(tx).createEntry({
          actorId: params.adminActorId, actionType: 'manual_ledger_adjustment', targetType: 'seller_invoice', targetId: current.id,
          previousData: { grossInvoiceAmount: current.grossInvoiceAmount.toFixed(2), invoiceDate: current.invoiceDate.toISOString(), description: current.description },
          newData: { grossInvoiceAmount: total.toFixed(2), invoiceDate: date.toISOString(), description }, reason: description,
        })
        await syncSellerPayoutBatches(tx, current.sellerId)
        return updated
      })
    },
  }
}
