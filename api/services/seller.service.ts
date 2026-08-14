/**
 * Seller service — orchestrates seller account operations.
 *
 * Responsibilities:
 * - seller onboarding submission and approval
 * - seller status transitions (suspend / reactivate)
 * - profile updates
 * - bank detail changes (security-sensitive — see security rules)
 *
 * Finance-critical rules:
 * - Bank detail changes are logged and do not activate instantly.
 * - Suspended sellers cannot receive payouts.
 */
import type { PrismaClient } from '@prisma/client'
import { createSellerRepository } from '../repositories/seller.repository'
import { createAdminAuditLogRepository } from '../repositories/admin-audit-log.repository'
import {
  NotFoundError,
  ValidationError,
  ForbiddenError,
} from '../lib/errors'
import { maskIban } from '@hanuja/security'
import { enqueueStoreSync } from '../jobs/search-index-sync.job'

export interface SellerOnboardingInput {
  userId: string
  storeName: string
  storeSlug: string
  companyName: string
  taxId: string
  phone: string
  address: string
}

export interface SellerProfileUpdateInput {
  storeName?: string
  bio?: string
  logoUrl?: string
  bannerUrl?: string
  bannerColor?: string
  bannerHeadline?: string
  bannerTextColor?: string
  bannerHeadlineFontSize?: string
  phone?: string
  companyName?: string
  legalAddress?: string
  district?: string
  city?: string
  postalCode?: string
  taxOffice?: string
  taxNumber?: string
  mersis?: string
}

export interface BankDetailUpdateInput {
  iban: string
  accountHolder: string
  bankName: string
  /** ID of admin or seller performing the change — used for audit */
  actorId: string
  actorRole: 'seller' | 'admin'
}

export function createSellerService(deps: { prisma: PrismaClient }) {
  const { prisma } = deps
  const sellerRepo = createSellerRepository(prisma)
  const auditLog = createAdminAuditLogRepository(prisma)

  async function submitOnboarding(input: SellerOnboardingInput): Promise<{ sellerId: string }> {
    // Check user doesn't already have a seller account
    const existing = await sellerRepo.findByUserId(input.userId)
    if (existing) {
      throw new ValidationError('Bu kullanıcı zaten bir satıcı hesabına sahip.')
    }

    // Check slug is not taken
    const slugTaken = await sellerRepo.findBySlug(input.storeSlug)
    if (slugTaken) {
      throw new ValidationError('Bu mağaza adresi zaten kullanımda. Lütfen farklı bir adres seçin.')
    }

    const seller = await prisma.seller.create({
      data: {
        userId: input.userId,
        slug: input.storeSlug,
        displayName: input.storeName,
        status: 'pending',
        profile: {
          create: {
            phone: input.phone,
            taxNumber: input.taxId,
          },
        },
      },
    })

    return { sellerId: seller.id }
  }

  async function approveSeller(
    sellerId: string,
    adminId: string,
  ): Promise<void> {
    const seller = await sellerRepo.findById(sellerId)
    if (!seller) throw new NotFoundError('Seller', sellerId)
    if (seller.status !== 'pending') {
      throw new ValidationError(`Satıcı onaylanamaz — mevcut durum: ${seller.status}`)
    }

    await prisma.$transaction(async (tx) => {
      await tx.seller.update({
        where: { id: sellerId },
        data: { status: 'active' },
      })
      await auditLog.createEntry({
        actorId: adminId,
        actionType: 'seller_activated',
        targetType: 'Seller',
        targetId: sellerId,
        previousData: { status: 'pending' },
        newData: { status: 'active' },
      })
    })
  }

  async function suspendSeller(
    sellerId: string,
    adminId: string,
    reason: string,
  ): Promise<void> {
    const seller = await sellerRepo.findById(sellerId)
    if (!seller) throw new NotFoundError('Seller', sellerId)
    if (seller.status === 'suspended') {
      throw new ValidationError('Satıcı zaten askıya alınmış.')
    }

    await prisma.$transaction(async (tx) => {
      await tx.seller.update({
        where: { id: sellerId },
        data: { status: 'suspended' },
      })
      await auditLog.createEntry({
        actorId: adminId,
        actionType: 'seller_suspended',
        targetType: 'Seller',
        targetId: sellerId,
        previousData: { status: seller.status },
        newData: { status: 'suspended' },
        reason,
      })
    })
  }

  async function reactivateSeller(
    sellerId: string,
    adminId: string,
  ): Promise<void> {
    const seller = await sellerRepo.findById(sellerId)
    if (!seller) throw new NotFoundError('Seller', sellerId)
    if (seller.status !== 'suspended') {
      throw new ValidationError(`Satıcı yeniden aktif edilemez — mevcut durum: ${seller.status}`)
    }

    await prisma.$transaction(async (tx) => {
      await tx.seller.update({
        where: { id: sellerId },
        data: { status: 'active' },
      })
      await auditLog.createEntry({
        actorId: adminId,
        actionType: 'seller_activated',
        targetType: 'Seller',
        targetId: sellerId,
        previousData: { status: 'suspended' },
        newData: { status: 'active' },
      })
    })
  }

  async function updateProfile(
    sellerId: string,
    actorId: string,
    input: SellerProfileUpdateInput,
  ): Promise<void> {
    const seller = await sellerRepo.findById(sellerId)
    if (!seller) throw new NotFoundError('Seller', sellerId)

    // Actor must be the seller themselves or an admin
    if (seller.userId !== actorId) {
      const user = await prisma.user.findUnique({ where: { id: actorId }, select: { role: true } })
      if (user?.role !== 'admin') throw new ForbiddenError('Profili güncelleme yetkiniz yok.')
    }

    // displayName (mağaza adı) Seller tablosunda
    let storeNameChanged = false

    if (input.storeName !== undefined) {
      await prisma.seller.update({
        where: { id: sellerId },
        data: { displayName: input.storeName },
      })
      storeNameChanged = input.storeName !== seller.displayName
    }

    // bio, logoUrl, banner alanları ve diğerleri SellerProfile tablosunda
    const profileData: Record<string, unknown> = {}
    if (input.bio !== undefined) profileData.bio = input.bio
    if (input.logoUrl !== undefined) profileData.logoUrl = input.logoUrl
    if (input.bannerUrl !== undefined) profileData.bannerUrl = input.bannerUrl
    if (input.bannerColor !== undefined) profileData.bannerColor = input.bannerColor
    if (input.bannerHeadline !== undefined) profileData.bannerHeadline = input.bannerHeadline
    if (input.bannerTextColor !== undefined) profileData.bannerTextColor = input.bannerTextColor
    if (input.bannerHeadlineFontSize !== undefined) profileData.bannerHeadlineFontSize = input.bannerHeadlineFontSize
    if (input.phone !== undefined) profileData.phone = input.phone
    if (input.companyName !== undefined) profileData.companyName = input.companyName
    if (input.legalAddress !== undefined) profileData.legalAddress = input.legalAddress
    if (input.district !== undefined) profileData.district = input.district
    if (input.city !== undefined) profileData.city = input.city
    if (input.postalCode !== undefined) profileData.postalCode = input.postalCode
    if (input.taxOffice !== undefined) profileData.taxOffice = input.taxOffice
    if (input.taxNumber !== undefined) profileData.taxNumber = input.taxNumber
    if (input.mersis !== undefined) profileData.mersis = input.mersis

    if (Object.keys(profileData).length > 0) {
      await prisma.sellerProfile.upsert({
        where: { sellerId },
        create: { sellerId, ...profileData },
        update: profileData,
      })
    }

    if (storeNameChanged) {
      await enqueueStoreSync({ entityId: sellerId }).catch((err) =>
        console.error('[seller] Search sync enqueue failed (store):', err),
      )
    }
  }

  async function updateVacationMode(
    sellerId: string,
    actorId: string,
    enabled: boolean,
  ): Promise<boolean> {
    const seller = await sellerRepo.findById(sellerId)
    if (!seller) throw new NotFoundError('Seller', sellerId)
    if (seller.userId !== actorId) {
      throw new ForbiddenError('Tatil Modu ayarını değiştirme yetkiniz yok.')
    }

    await prisma.$transaction(async (tx) => {
      await tx.seller.update({
        where: { id: sellerId },
        data: { vacationModeEnabled: enabled },
      })

      if (enabled) {
        const productIds = await tx.product.findMany({
          where: { sellerId },
          select: { id: true },
        })
        if (productIds.length > 0) {
          await tx.cartItem.deleteMany({
            where: { productId: { in: productIds.map((product) => product.id) } },
          })
        }
      }
    })

    await enqueueStoreSync({
      entityId: sellerId,
      operation: enabled ? 'delete' : 'upsert',
    }).catch((err) =>
      console.error('[seller] Search sync enqueue failed (vacation mode):', err),
    )

    return enabled
  }

  /**
   * Update seller bank/payout details.
   *
   * Security: changes are logged immediately and do not activate
   * for payout until verified. See security rules §seller-iban-verification.
   */
  async function updateBankDetails(
    sellerId: string,
    input: BankDetailUpdateInput,
  ): Promise<void> {
    const seller = await sellerRepo.findById(sellerId)
    if (!seller) throw new NotFoundError('Seller', sellerId)

    // Sellers can only change their own bank details
    if (input.actorRole === 'seller' && seller.userId !== input.actorId) {
      throw new ForbiddenError('Banka bilgilerini güncelleme yetkiniz yok.')
    }

    const previous = seller.bankDetails?.[0] ?? null

    await prisma.$transaction(async (tx) => {
      // Create a new bank detail record — isActive=false until admin activates
      await tx.sellerBankDetail.create({
        data: {
          sellerId,
          iban: input.iban,
          accountHolder: input.accountHolder,
          bankName: input.bankName,
          isActive: false,
          isVerified: false,
        },
      })
      await auditLog.createEntry({
        actorId: input.actorId,
        actionType: 'seller_bank_detail_changed',
        targetType: 'SellerBankDetail',
        targetId: sellerId,
        previousData: { iban: previous?.iban ? maskIban(previous.iban) : null },
        newData: { iban: maskIban(input.iban) },
        note: 'Banka bilgisi değişikliği — admin onayı bekliyor',
      })
    })
  }

  return {
    submitOnboarding,
    approveSeller,
    suspendSeller,
    reactivateSeller,
    updateProfile,
    updateVacationMode,
    updateBankDetails,
  }
}
