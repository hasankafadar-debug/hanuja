/**
 * Seller document service — KYC belge yönetimi.
 *
 * Flow:
 *  1. Satıcı /api/seller/documents POST → presigned upload URL alır, pending SellerDocument oluşur.
 *  2. Satıcı dosyayı doğrudan R2'ye PUT eder (presigned URL ile).
 *  3. Satıcı /api/seller/documents/[id]/confirm POST → belge "pending review" durumuna geçer.
 *  4. Admin /api/admin/documents/[id]/review POST → approve veya reject yapar, audit log yazılır.
 *
 * Güvenlik:
 *  - Satıcı yalnızca kendi belgelerini yönetebilir.
 *  - Silme yalnızca pending belgeler için izinlidir.
 *  - R2 dosyası da silinir.
 */
import type { PrismaClient, SellerDocumentType } from '@prisma/client'
import { createSellerDocumentRepository } from '../repositories/seller-document.repository'
import {
  generatePresignedUploadUrl,
  deleteObject,
  objectExists,
  DOCUMENT_ALLOWED_MIME_TYPES,
  DOCUMENT_MAX_SIZE_BYTES,
} from '../lib/r2'
import { NotFoundError, ValidationError, ForbiddenError } from '../lib/errors'

export const DOCUMENT_TYPE_LABELS: Record<SellerDocumentType, string> = {
  identity: 'Kimlik Belgesi (TC Kimlik / Pasaport)',
  tax_certificate: 'Vergi Levhası',
  trade_registry: 'Ticaret Sicil Gazetesi',
  signature_circular: 'İmza Sirküleri',
  bank_statement: 'Banka Hesap Cüzdanı / IBAN Belgesi',
  other: 'Diğer Belge',
}

export function createSellerDocumentService(deps: { prisma: PrismaClient }) {
  const { prisma } = deps
  const docRepo = createSellerDocumentRepository(prisma)

  /**
   * Satıcının belge yüklemesi için presigned URL üretir ve pending kayıt oluşturur.
   * Upload tamamlandıktan sonra confirm endpoint'i çağrılmalıdır.
   */
  async function requestUploadUrl(opts: {
    sellerId: string
    type: SellerDocumentType
    fileName: string
    mimeType: string
    sizeBytes: number
  }) {
    const { sellerId, type, fileName, mimeType, sizeBytes } = opts

    if (!DOCUMENT_ALLOWED_MIME_TYPES.has(mimeType)) {
      throw new ValidationError(
        'Desteklenmeyen dosya türü. Lütfen JPEG, PNG, WEBP veya PDF yükleyin.',
      )
    }

    if (sizeBytes > DOCUMENT_MAX_SIZE_BYTES) {
      throw new ValidationError('Dosya boyutu 20 MB limitini aşıyor.')
    }

    const { uploadUrl, key, publicUrl, expiresIn } = await generatePresignedUploadUrl({
      folder: 'documents',
      mimeType,
      ownerId: sellerId,
    })

    const document = await docRepo.create({
      sellerId,
      type,
      fileUrl: publicUrl,
      fileKey: key,
      fileName,
      mimeType,
      sizeBytes,
    })

    return { document, uploadUrl, expiresIn }
  }

  /**
   * Satıcının belgelerini listeler.
   */
  async function listDocuments(sellerId: string) {
    return docRepo.findBySeller(sellerId)
  }

  /**
   * Belgeyi siler. Yalnızca pending durumdaki belgeler satıcı tarafından silinebilir.
   * Approved/rejected belgeler admin tarafından silinebilir (veya hiç silinmez).
   */
  async function deleteDocument(documentId: string, sellerId: string) {
    const doc = await docRepo.findById(documentId)
    if (!doc) throw new NotFoundError('SellerDocument', documentId)
    if (doc.sellerId !== sellerId) throw new ForbiddenError('Bu belgeye erişim yetkiniz yok.')
    if (doc.status !== 'pending') {
      throw new ValidationError('Yalnızca beklemedeki belgeler silinebilir.')
    }

    await docRepo.deleteById(documentId)
    // R2'den sil — hata olursa loglayıp devam et (orphan key kabul edilebilir)
    await deleteObject(doc.fileKey).catch(() => null)
  }

  /**
   * Satıcı upload tamamlandıktan sonra belge kaydını doğrular.
   * pending durumu korunur; bu durum "upload doğrulandı, admin incelemesinde" anlamına gelir.
   */
  async function confirmUpload(documentId: string, sellerId: string) {
    const doc = await docRepo.findById(documentId)
    if (!doc) throw new NotFoundError('SellerDocument', documentId)
    if (doc.sellerId !== sellerId) throw new ForbiddenError('Bu belgeye erişim yetkiniz yok.')
    if (doc.status !== 'pending') {
      throw new ValidationError(`Belge zaten incelendi: ${doc.status}`)
    }

    const exists = await objectExists(doc.fileKey)
    if (!exists) {
      await docRepo.deleteById(documentId)
      throw new ValidationError('Dosya yüklemesi doğrulanamadı. Lütfen tekrar deneyin.')
    }

    await prisma.sellerDocument.update({
      where: { id: documentId },
      data: { updatedAt: new Date() },
    })
  }

  /**
   * Admin: belgeyi onaylar veya reddeder.
   */
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

  /**
   * Admin: belirli satıcının tüm belgelerini listeler.
   */
  async function listDocumentsBySeller(sellerId: string) {
    return docRepo.findBySeller(sellerId)
  }

  /**
   * Admin: inceleme bekleyen tüm belgeler.
   */
  async function listPendingDocuments() {
    return docRepo.listPending()
  }

  return {
    requestUploadUrl,
    listDocuments,
    deleteDocument,
    confirmUpload,
    reviewDocument,
    listDocumentsBySeller,
    listPendingDocuments,
  }
}
