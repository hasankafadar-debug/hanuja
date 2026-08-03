import type { Prisma, PrismaClient, SellerDocumentType, SellerStatus } from '@prisma/client'
import { maskIban } from '@hanuja/security'
import { createAdminAuditLogRepository } from '../repositories/admin-audit-log.repository'
import { DomainError, NotFoundError } from '../lib/errors'

const SELLER_DOCUMENT_TYPES = new Set<SellerDocumentType>([
  'identity',
  'tax_certificate',
  'trade_registry',
  'signature_circular',
  'bank_statement',
  'contract',
  'other',
])

type ActivationClient = Prisma.TransactionClient

type ActivationReadiness = {
  sellerId: string
  previousStatus: SellerStatus
  pendingBankDetailId: string
}

export function getRequiredDocumentTypes(value: unknown): SellerDocumentType[] {
  if (!Array.isArray(value)) return []

  return [
    ...new Set(
      value.filter(
        (item): item is SellerDocumentType =>
          typeof item === 'string' && SELLER_DOCUMENT_TYPES.has(item as SellerDocumentType),
      ),
    ),
  ]
}

function activationValidationError(message: string, details?: Record<string, unknown>) {
  return new DomainError(message, 'VALIDATION_ERROR', 422, details)
}

async function readAndValidateActivation(
  db: ActivationClient,
  sellerId: string,
): Promise<ActivationReadiness> {
  const seller = await db.seller.findUnique({
    where: { id: sellerId },
    select: {
      id: true,
      status: true,
      requiredDocumentTypes: true,
      profile: { select: { id: true } },
      bankDetails: {
        where: { status: 'PENDING_ACTIVATION' },
        // Pending applicants cannot use the post-activation bank-change API. The
        // oldest pending row is therefore the original onboarding bank account.
        orderBy: { createdAt: 'asc' },
        take: 1,
        select: { id: true },
      },
      documents: {
        where: { status: 'approved' },
        select: {
          type: true,
          identityPart: true,
          uploadGroupId: true,
          uploadOrder: true,
          uploadGroupSize: true,
        },
      },
    },
  })

  if (!seller) throw new NotFoundError('Seller', sellerId)

  if (seller.status !== 'pending' && seller.status !== 'rejected') {
    throw activationValidationError(
      `Satıcı ilk aktivasyon akışıyla aktifleştirilemez; mevcut durum: ${seller.status}.`,
    )
  }

  const requiredDocumentTypes = getRequiredDocumentTypes(seller.requiredDocumentTypes)
  if (requiredDocumentTypes.length === 0) {
    throw activationValidationError(
      'Satıcı aktifleştirilmeden önce en az bir belge talep edilmelidir.',
      { missingDocumentTypes: [] },
    )
  }

  const approvedIdentityParts = new Set(
    seller.documents
      .filter((document) => document.type === 'identity')
      .map((document) => document.identityPart ?? 'combined'),
  )
  const identityIsComplete =
    approvedIdentityParts.has('combined') ||
    (approvedIdentityParts.has('front') && approvedIdentityParts.has('back'))
  const approvedContractGroups = new Map<string, { size: number; orders: Set<number> }>()
  for (const document of seller.documents.filter((item) => item.type === 'contract')) {
    if (
      !document.uploadGroupId ||
      document.uploadGroupSize == null ||
      document.uploadOrder == null
    ) {
      continue
    }
    const group = approvedContractGroups.get(document.uploadGroupId) ?? {
      size: document.uploadGroupSize,
      orders: new Set<number>(),
    }
    if (group.size === document.uploadGroupSize) group.orders.add(document.uploadOrder)
    approvedContractGroups.set(document.uploadGroupId, group)
  }
  const contractIsComplete = [...approvedContractGroups.values()].some(
    (group) =>
      group.size > 0 &&
      group.orders.size === group.size &&
      Array.from({ length: group.size }, (_, index) => index).every((index) =>
        group.orders.has(index),
      ),
  )
  const approvedDocumentTypes = new Set(
    seller.documents
      .filter(
        (document) =>
          (document.type !== 'identity' || identityIsComplete) &&
          (document.type !== 'contract' || contractIsComplete),
      )
      .map((document) => document.type),
  )
  const missingDocumentTypes = requiredDocumentTypes.filter(
    (documentType) => !approvedDocumentTypes.has(documentType),
  )
  if (missingDocumentTypes.length > 0) {
    throw activationValidationError(
      'Talep edilen tüm belgeler onaylanmadan satıcı aktifleştirilemez.',
      { missingDocumentTypes },
    )
  }

  if (!seller.profile) {
    throw activationValidationError('Satıcı profili bulunamadığı için aktivasyon tamamlanamadı.')
  }

  const pendingBankDetail = seller.bankDetails[0] ?? null
  if (!pendingBankDetail) {
    throw activationValidationError(
      'Başvuruda girilmiş, aktivasyon bekleyen banka hesabı bulunamadı.',
    )
  }

  return {
    sellerId: seller.id,
    previousStatus: seller.status,
    pendingBankDetailId: pendingBankDetail.id,
  }
}

export function createAdminSellerActivationService({ prisma }: { prisma: PrismaClient }) {
  async function assertReady(sellerId: string) {
    return readAndValidateActivation(prisma as unknown as ActivationClient, sellerId)
  }

  async function activateInitial(params: { sellerId: string; adminActorId: string }) {
    return prisma.$transaction(async (tx) => {
      const readiness = await readAndValidateActivation(tx, params.sellerId)
      const activatedAt = new Date()

      const pendingBankDetail = await tx.sellerBankDetail.findUniqueOrThrow({
        where: { id: readiness.pendingBankDetailId },
        select: { id: true, iban: true, previousIbanMasked: true },
      })
      const supersededBankDetails = await tx.sellerBankDetail.findMany({
        where: {
          sellerId: params.sellerId,
          id: { not: pendingBankDetail.id },
          isActive: true,
        },
        select: { id: true, iban: true, previousIbanMasked: true },
      })

      if (supersededBankDetails.length > 0) {
        await tx.sellerBankDetail.updateMany({
          where: {
            id: { in: supersededBankDetails.map((detail) => detail.id) },
          },
          data: { isActive: false, status: 'SUPERSEDED' },
        })
        await tx.sellerBankDetailHistory.createMany({
          data: supersededBankDetails.map((detail) => ({
            sellerId: params.sellerId,
            bankDetailId: detail.id,
            action: 'superseded',
            ibanMasked: maskIban(detail.iban),
            previousIbanMasked: detail.previousIbanMasked,
            actorId: params.adminActorId,
            actorRole: 'admin',
            reason: 'Satıcı başvurusu aktivasyonu sırasında pasifleştirildi.',
          })),
        })
      }

      const bankActivation = await tx.sellerBankDetail.updateMany({
        where: {
          id: pendingBankDetail.id,
          sellerId: params.sellerId,
          status: 'PENDING_ACTIVATION',
        },
        data: {
          status: 'ACTIVE',
          isActive: true,
          isVerified: true,
          verifiedBy: params.adminActorId,
          verifiedAt: activatedAt,
          activatedAt,
        },
      })
      if (bankActivation.count !== 1) {
        throw activationValidationError(
          'Aktivasyon bekleyen banka hesabı işlem sırasında değişti. Lütfen yeniden deneyin.',
        )
      }
      await tx.sellerBankDetailHistory.create({
        data: {
          sellerId: params.sellerId,
          bankDetailId: pendingBankDetail.id,
          action: 'activated',
          ibanMasked: maskIban(pendingBankDetail.iban),
          previousIbanMasked: pendingBankDetail.previousIbanMasked,
          actorId: params.adminActorId,
          actorRole: 'admin',
          reason: 'Satıcı başvurusu onaylandı.',
        },
      })

      await tx.sellerProfile.update({
        where: { sellerId: params.sellerId },
        data: { isVerified: true, verifiedAt: activatedAt },
      })
      await tx.seller.update({
        where: { id: params.sellerId },
        data: { status: 'active' },
      })
      await createAdminAuditLogRepository(tx as unknown as PrismaClient).createEntry({
        actorId: params.adminActorId,
        actionType: 'seller_activated',
        targetType: 'seller',
        targetId: params.sellerId,
        previousData: { status: readiness.previousStatus },
        newData: { status: 'active' },
      })

      return readiness
    })
  }

  return { assertReady, activateInitial }
}
