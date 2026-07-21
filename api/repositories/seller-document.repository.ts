/**
 * Seller document repository — persistence access only, no business policy.
 *
 * KYC belgelerinin CRUD'u. Approve/reject kararı service katmanında.
 */
import type {
  PrismaClient,
  SellerDocumentIdentityPart,
  SellerDocumentType,
  SellerDocumentStatus,
} from '@prisma/client'

export function createSellerDocumentRepository(prisma: PrismaClient) {
  async function create(data: {
    sellerId: string
    type: SellerDocumentType
    identityPart: SellerDocumentIdentityPart | null
    fileUrl: string
    fileKey: string
    fileName: string
    mimeType: string
    sizeBytes: number
  }) {
    return prisma.sellerDocument.create({ data })
  }

  async function findById(id: string) {
    return prisma.sellerDocument.findUnique({ where: { id } })
  }

  async function findBySeller(sellerId: string) {
    return prisma.sellerDocument.findMany({
      where: { sellerId },
      orderBy: { createdAt: 'desc' },
    })
  }

  async function findBySellerAndType(sellerId: string, type: SellerDocumentType) {
    return prisma.sellerDocument.findMany({
      where: { sellerId, type },
      orderBy: { createdAt: 'desc' },
    })
  }

  async function listPending() {
    return prisma.sellerDocument.findMany({
      where: { status: 'pending' },
      include: { seller: { select: { displayName: true, slug: true } } },
      orderBy: { createdAt: 'asc' },
    })
  }

  async function updateStatus(
    id: string,
    status: SellerDocumentStatus,
    opts: { adminNote?: string; reviewedBy: string },
  ) {
    return prisma.sellerDocument.update({
      where: { id },
      data: {
        status,
        adminNote: opts.adminNote ?? null,
        reviewedBy: opts.reviewedBy,
        reviewedAt: new Date(),
      },
    })
  }

  async function deleteById(id: string) {
    return prisma.sellerDocument.delete({ where: { id } })
  }

  return {
    create,
    findById,
    findBySeller,
    findBySellerAndType,
    listPending,
    updateStatus,
    deleteById,
  }
}
