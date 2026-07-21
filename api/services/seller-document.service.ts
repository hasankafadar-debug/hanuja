/**
 * Seller KYC document service.
 *
 * KYC bytes are accepted by the server and encrypted in the private local
 * document store. Product images and other public media keep using R2.
 */
import type {
  PrismaClient,
  SellerDocumentIdentityPart,
  SellerDocumentType,
} from '@prisma/client'
import { createSellerDocumentRepository } from '../repositories/seller-document.repository'
import {
  createPrivateDocumentStorage,
  isPrivateDocumentStorageKey,
  type PrivateDocumentStorage,
} from '../lib/private-document-storage'
import { deleteObject } from '../lib/r2'
import { NotFoundError, ValidationError, ForbiddenError } from '../lib/errors'

export const DOCUMENT_ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
])
export const DOCUMENT_MAX_SIZE_BYTES = 20 * 1024 * 1024

export const IDENTITY_PARTS = new Set<SellerDocumentIdentityPart>(['combined', 'front', 'back'])

export const LEGACY_DOCUMENT_REUPLOAD_MESSAGE =
  'Bu belge eski depolama sisteminde kaldığı için kullanılamıyor. Satıcıdan belgeyi yeniden yüklemesini isteyin.'

export const DOCUMENT_TYPE_LABELS: Record<SellerDocumentType, string> = {
  identity: 'Kimlik Belgesi (TC Kimlik / Pasaport)',
  tax_certificate: 'Vergi Levhası',
  trade_registry: 'Ticaret Sicil Gazetesi',
  signature_circular: 'İmza Sirküleri',
  bank_statement: 'Banka Hesap Cüzdanı / IBAN Belgesi',
  other: 'Diğer Belge',
}

function hasExpectedFileSignature(bytes: Uint8Array, mimeType: string): boolean {
  if (mimeType === 'application/pdf') {
    return Buffer.from(bytes.subarray(0, 5)).equals(Buffer.from('%PDF-', 'ascii'))
  }
  if (mimeType === 'image/jpeg') {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  }
  if (mimeType === 'image/png') {
    return Buffer.from(bytes.subarray(0, 8)).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    )
  }
  if (mimeType === 'image/webp') {
    return (
      bytes.length >= 12 &&
      Buffer.from(bytes.subarray(0, 4)).equals(Buffer.from('RIFF', 'ascii')) &&
      Buffer.from(bytes.subarray(8, 12)).equals(Buffer.from('WEBP', 'ascii'))
    )
  }
  return false
}

function validateUpload(file: { fileName: string; mimeType: string; bytes: Uint8Array }): void {
  if (!file.fileName.trim()) throw new ValidationError('Dosya adı zorunludur.')
  if (!DOCUMENT_ALLOWED_MIME_TYPES.has(file.mimeType)) {
    throw new ValidationError(
      'Desteklenmeyen dosya türü. Lütfen JPEG, PNG, WEBP veya PDF yükleyin.',
    )
  }
  if (file.bytes.byteLength === 0) throw new ValidationError('Boş dosya yüklenemez.')
  if (file.bytes.byteLength > DOCUMENT_MAX_SIZE_BYTES) {
    throw new ValidationError('Dosya boyutu 20 MB limitini aşıyor.')
  }
  if (!hasExpectedFileSignature(file.bytes, file.mimeType)) {
    throw new ValidationError('Dosyanın içeriği bildirilen dosya türüyle eşleşmiyor.')
  }
}

export function isLegacySellerDocument(document: { fileKey: string }): boolean {
  return !isPrivateDocumentStorageKey(document.fileKey)
}

function withStorageState<T extends { fileKey: string }>(document: T) {
  const requiresReupload = isLegacySellerDocument(document)
  return {
    ...document,
    requiresReupload,
    fileAvailable: !requiresReupload,
  }
}

export function createSellerDocumentService(deps: {
  prisma: PrismaClient
  storage?: PrivateDocumentStorage
  deleteLegacyObject?: (fileKey: string) => Promise<void>
}) {
  const { prisma } = deps
  let resolvedStorage = deps.storage
  const storage = () => (resolvedStorage ??= createPrivateDocumentStorage())
  const removeLegacyObject = deps.deleteLegacyObject ?? deleteObject
  const docRepo = createSellerDocumentRepository(prisma)

  async function uploadDocument(opts: {
    sellerId: string
    type: SellerDocumentType
    identityPart?: SellerDocumentIdentityPart | null
    fileName: string
    mimeType: string
    bytes: Uint8Array
  }) {
    validateUpload(opts)
    const identityPart = opts.type === 'identity' ? (opts.identityPart ?? 'combined') : null
    if (opts.type !== 'identity' && opts.identityPart != null) {
      throw new ValidationError('Kimlik parçası yalnızca kimlik belgesi için seçilebilir.')
    }
    if (opts.type === 'identity' && !IDENTITY_PARTS.has(identityPart!)) {
      throw new ValidationError('Geçersiz kimlik parçası.')
    }

    const existingDocuments = await docRepo.findBySellerAndType(opts.sellerId, opts.type)
    const occupiedDocuments = existingDocuments.filter(
      (document) =>
        (document.status === 'pending' || document.status === 'approved') &&
        !isLegacySellerDocument(document),
    )

    if (opts.type === 'identity') {
      const occupiedParts = new Set(
        occupiedDocuments.map((document) => document.identityPart ?? 'combined'),
      )
      const slotOccupied =
        identityPart === 'combined'
          ? occupiedParts.size > 0
          : occupiedParts.has('combined') || occupiedParts.has(identityPart!)
      if (slotOccupied) {
        throw new ValidationError(
          identityPart === 'combined'
            ? 'Kimlik için tek dosya veya ön/arka yüz yüklemelerinden biri zaten mevcut.'
            : `Kimlik ${identityPart === 'front' ? 'ön' : 'arka'} yüzü için incelenen veya onaylanan bir yükleme zaten var.`,
        )
      }
    }

    const legacyDocuments = existingDocuments.filter(isLegacySellerDocument)
    const stored = await storage().write(opts.bytes)

    let document: Awaited<ReturnType<typeof docRepo.create>>
    try {
      document = await docRepo.create({
        sellerId: opts.sellerId,
        type: opts.type,
        identityPart,
        fileUrl: 'private://seller-document',
        fileKey: stored.key,
        fileName: opts.fileName.trim().slice(0, 255),
        mimeType: opts.mimeType,
        sizeBytes: opts.bytes.byteLength,
      })
    } catch (error) {
      await storage()
        .delete(stored.key)
        .catch(() => undefined)
      throw error
    }

    // A legacy R2 object is only removed after the replacement is both encrypted
    // and referenced by a committed database row. If R2 deletion fails before
    // any legacy object is removed, roll the replacement back so the seller can
    // retry without accumulating duplicate active records.
    let removedLegacyObject = false
    for (const legacyDocument of legacyDocuments) {
      try {
        await removeLegacyObject(legacyDocument.fileKey)
        removedLegacyObject = true
      } catch (error) {
        if (!removedLegacyObject) {
          try {
            await docRepo.deleteById(document.id)
            await storage().delete(stored.key)
          } catch (rollbackError) {
            console.error('Seller KYC replacement rollback failed', {
              documentId: document.id,
              error: rollbackError,
            })
          }
          throw new ValidationError(
            'Eski belge güvenli şekilde kaldırılamadı. Lütfen yüklemeyi tekrar deneyin.',
          )
        }

        // At least one old copy is already gone, so rolling the valid private
        // replacement back would create data loss. Keep it authoritative and
        // surface the remaining stale legacy row as requiresReupload.
        console.error('Legacy seller KYC object cleanup incomplete', {
          legacyDocumentId: legacyDocument.id,
          replacementDocumentId: document.id,
          error,
        })
        break
      }

      try {
        await docRepo.deleteById(legacyDocument.id)
      } catch (error) {
        // The replacement remains authoritative: deleting its private bytes here
        // would leave the seller without the only usable KYC copy. The stale row
        // stays fail-closed and will be retried by a later replacement/cleanup.
        console.error('Legacy seller KYC database cleanup failed', {
          legacyDocumentId: legacyDocument.id,
          replacementDocumentId: document.id,
          error,
        })
      }
    }

    return withStorageState(document)
  }

  async function listDocuments(sellerId: string) {
    const documents = await docRepo.findBySeller(sellerId)
    return documents.map(withStorageState)
  }

  async function deleteDocument(documentId: string, sellerId: string) {
    const doc = await docRepo.findById(documentId)
    if (!doc) throw new NotFoundError('SellerDocument', documentId)
    if (doc.sellerId !== sellerId) throw new ForbiddenError('Bu belgeye erişim yetkiniz yok.')
    if (doc.status !== 'pending') {
      throw new ValidationError('Yalnızca beklemedeki belgeler silinebilir.')
    }

    // Delete the bytes first. If that fails, keep the database record so the
    // operation can be retried without losing the only pointer to the file.
    if (isLegacySellerDocument(doc)) {
      await removeLegacyObject(doc.fileKey)
    } else {
      await storage().delete(doc.fileKey)
    }
    await docRepo.deleteById(documentId)
  }

  /**
   * Compatibility endpoint for clients deployed during the old two-step flow.
   * New direct uploads are already complete when the database record is created.
   */
  async function confirmUpload(documentId: string, sellerId: string) {
    const doc = await docRepo.findById(documentId)
    if (!doc) throw new NotFoundError('SellerDocument', documentId)
    if (doc.sellerId !== sellerId) throw new ForbiddenError('Bu belgeye erişim yetkiniz yok.')
    if (doc.status !== 'pending') {
      throw new ValidationError(`Belge zaten incelendi: ${doc.status}`)
    }
    if (isLegacySellerDocument(doc)) throw new ValidationError(LEGACY_DOCUMENT_REUPLOAD_MESSAGE)

    if (!(await storage().exists(doc.fileKey))) {
      await docRepo.deleteById(documentId)
      throw new ValidationError('Dosya yüklemesi doğrulanamadı. Lütfen tekrar deneyin.')
    }

    await prisma.sellerDocument.update({
      where: { id: documentId },
      data: { updatedAt: new Date() },
    })
  }

  async function readDocumentFile(documentId: string) {
    const document = await docRepo.findById(documentId)
    if (!document) throw new NotFoundError('SellerDocument', documentId)
    if (isLegacySellerDocument(document)) {
      throw new ValidationError(LEGACY_DOCUMENT_REUPLOAD_MESSAGE)
    }
    const bytes = await storage().read(document.fileKey)
    return { document, bytes }
  }

  async function documentFileExists(documentId: string): Promise<boolean> {
    const document = await docRepo.findById(documentId)
    if (!document) throw new NotFoundError('SellerDocument', documentId)
    if (isLegacySellerDocument(document)) {
      throw new ValidationError(LEGACY_DOCUMENT_REUPLOAD_MESSAGE)
    }
    return storage().exists(document.fileKey)
  }

  async function reviewDocument(opts: {
    documentId: string
    adminId: string
    decision: 'approved' | 'rejected'
    note?: string
  }) {
    const { documentId, adminId, decision, note } = opts
    const normalizedNote = note?.trim() || undefined

    const doc = await docRepo.findById(documentId)
    if (!doc) throw new NotFoundError('SellerDocument', documentId)
    if (doc.status !== 'pending') {
      throw new ValidationError(`Belge zaten incelendi: ${doc.status}`)
    }
    if (decision === 'rejected' && !normalizedNote) {
      throw new ValidationError('Ret kararında gerekçe zorunludur.')
    }
    if (decision === 'approved' && isLegacySellerDocument(doc)) {
      throw new ValidationError(LEGACY_DOCUMENT_REUPLOAD_MESSAGE)
    }

    if (decision === 'approved') {
      try {
        await storage().read(doc.fileKey)
      } catch {
        throw new ValidationError(
          'Belge dosyası özel depoda doğrulanamadı. Satıcıdan belgeyi yeniden yüklemesini isteyin.',
        )
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.sellerDocument.update({
        where: { id: documentId },
        data: {
          status: decision,
          adminNote: normalizedNote ?? null,
          reviewedBy: adminId,
          reviewedAt: new Date(),
        },
      })

      await tx.adminAuditLog.create({
        data: {
          actorId: adminId,
          actionType:
            decision === 'approved' ? 'seller_document_approved' : 'seller_document_rejected',
          targetType: 'SellerDocument',
          targetId: documentId,
          previousData: { status: 'pending', type: doc.type } as never,
          newData: { status: decision } as never,
          ...(normalizedNote ? { reason: normalizedNote } : {}),
        },
      })
    })
  }

  async function listDocumentsBySeller(sellerId: string) {
    const documents = await docRepo.findBySeller(sellerId)
    return documents.map(withStorageState)
  }

  async function listPendingDocuments() {
    const documents = await docRepo.listPending()
    return documents.map(withStorageState)
  }

  return {
    uploadDocument,
    listDocuments,
    deleteDocument,
    confirmUpload,
    readDocumentFile,
    documentFileExists,
    reviewDocument,
    listDocumentsBySeller,
    listPendingDocuments,
  }
}
