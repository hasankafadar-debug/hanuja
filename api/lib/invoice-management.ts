import { createHash } from 'node:crypto'
import { DomainError, ForbiddenError, ValidationError } from './errors'

export const SELLER_INVOICE_EDIT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000
export const INVOICE_EDIT_EXPIRED_MESSAGE = '30 günlük düzeltme süresi doldu. Değişiklik için Hanuja yönetimiyle iletişime geçin.'

export function isInvoiceManagementEnabled() {
  return process.env.INVOICE_MANAGEMENT_ENABLED?.trim().toLowerCase() === 'true'
}

export function requireInvoiceManagement() {
  if (!isInvoiceManagementEnabled()) {
    throw new DomainError('Fatura yönetimi şu anda kullanıma kapalı.', 'INVOICE_MANAGEMENT_DISABLED', 503)
  }
}

export function getInvoiceRevision(invoice: { id: string; fileKey: string }) {
  return createHash('sha256').update(`${invoice.id}\0${invoice.fileKey}`).digest('hex')
}

export function invoiceEditDeadline(firstUploadedAt: Date | null) {
  return firstUploadedAt ? new Date(firstUploadedAt.getTime() + SELLER_INVOICE_EDIT_WINDOW_MS) : null
}

export function assertSellerInvoiceWindow(firstUploadedAt: Date | null, now = new Date()) {
  const deadline = invoiceEditDeadline(firstUploadedAt)
  if (deadline && now.getTime() >= deadline.getTime()) throw new ForbiddenError(INVOICE_EDIT_EXPIRED_MESSAGE)
}

export function validateInvoiceReason(reason: string | null | undefined) {
  const value = reason?.trim() ?? ''
  if (value.length < 5 || value.length > 1000) {
    throw new ValidationError('Gerekçe 5 ile 1000 karakter arasında olmalıdır.')
  }
  return value
}

export function assertInvoiceRevision(invoice: { id: string; fileKey: string } | null, expected: string | null | undefined) {
  if (!invoice && !expected) return
  if (!expected) throw new DomainError('Fatura sürümü gerekli. Sayfayı yenileyin.', 'INVOICE_PRECONDITION_REQUIRED', 428)
  const normalized = expected.trim().replace(/^"([a-f0-9]{64})"$/, '$1')
  if (!invoice || normalized !== getInvoiceRevision(invoice)) {
    throw new DomainError('Fatura değişti. Sayfayı yenileyip tekrar deneyin.', 'INVOICE_CHANGED', 412)
  }
}
