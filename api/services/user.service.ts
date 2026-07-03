/**
 * User service — orchestrates customer account operations.
 *
 * Responsibilities:
 * - profile update (name, image)
 * - address management (CRUD, default selection)
 *
 * These are customer-facing account operations.
 * Seller-specific operations live in seller.service.ts.
 */
import type { PrismaClient } from '@prisma/client'
import { createUserRepository } from '../repositories/user.repository'
import { NotFoundError, ValidationError, ForbiddenError } from '../lib/errors'

export interface ProfileUpdateInput {
  name?: string
  image?: string
}

export interface AddressInput {
  label?: string
  fullName: string
  phone: string
  addressLine1: string
  addressLine2?: string
  district: string
  city: string
  postalCode?: string
  country?: string
  isDefault?: boolean
  isBillingAddress?: boolean
  invoiceType?: 'individual' | 'corporate'
  tcNumber?: string
  isForeignNational?: boolean
  companyName?: string
  taxOffice?: string
  taxNumber?: string
}

export function createUserService(deps: { prisma: PrismaClient }) {
  const { prisma } = deps
  const userRepo = createUserRepository(prisma)

  async function getProfile(userId: string) {
    const user = await userRepo.findById(userId)
    if (!user) throw new NotFoundError('User', userId)
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      image: user.image,
      role: user.role,
      createdAt: user.createdAt,
    }
  }

  async function updateProfile(userId: string, input: ProfileUpdateInput) {
    const user = await userRepo.findById(userId)
    if (!user) throw new NotFoundError('User', userId)

    return prisma.user.update({
      where: { id: userId },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.image !== undefined && { image: input.image }),
      },
      select: { id: true, name: true, email: true, image: true, role: true },
    })
  }

  // ── Address management ──

  async function listAddresses(userId: string) {
    return prisma.address.findMany({
      where: { userId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    })
  }

  async function addAddress(userId: string, input: AddressInput) {
    const user = await userRepo.findById(userId)
    if (!user) throw new NotFoundError('User', userId)

    // If this is marked default, unset other defaults
    if (input.isDefault) {
      await prisma.address.updateMany({
        where: { userId, isDefault: true },
        data: { isDefault: false },
      })
    }

    return prisma.address.create({
      data: {
        userId,
        ...(input.label !== undefined ? { label: input.label } : {}),
        fullName: input.fullName,
        phone: input.phone,
        addressLine1: input.addressLine1,
        ...(input.addressLine2 !== undefined ? { addressLine2: input.addressLine2 } : {}),
        district: input.district,
        city: input.city,
        postalCode: input.postalCode ?? '',
        country: input.country ?? 'TR',
        isDefault: input.isDefault ?? false,
        isBillingAddress: input.isBillingAddress ?? false,
        ...(input.invoiceType !== undefined ? { invoiceType: input.invoiceType } : {}),
        ...(input.tcNumber !== undefined ? { tcNumber: input.tcNumber } : {}),
        isForeignNational: input.isForeignNational ?? false,
        ...(input.companyName !== undefined ? { companyName: input.companyName } : {}),
        ...(input.taxOffice !== undefined ? { taxOffice: input.taxOffice } : {}),
        ...(input.taxNumber !== undefined ? { taxNumber: input.taxNumber } : {}),
      },
    })
  }

  async function updateAddress(userId: string, addressId: string, input: Partial<AddressInput>) {
    const address = await prisma.address.findUnique({ where: { id: addressId } })
    if (!address) throw new NotFoundError('Address', addressId)
    if (address.userId !== userId) throw new ForbiddenError('Bu adres size ait değil.')

    if (input.isDefault) {
      await prisma.address.updateMany({
        where: { userId, isDefault: true, id: { not: addressId } },
        data: { isDefault: false },
      })
    }

    return prisma.address.update({
      where: { id: addressId },
      data: {
        ...(input.label !== undefined && { label: input.label }),
        ...(input.fullName !== undefined && { fullName: input.fullName }),
        ...(input.phone !== undefined && { phone: input.phone }),
        ...(input.addressLine1 !== undefined && { addressLine1: input.addressLine1 }),
        ...(input.addressLine2 !== undefined && { addressLine2: input.addressLine2 }),
        ...(input.district !== undefined && { district: input.district }),
        ...(input.city !== undefined && { city: input.city }),
        ...(input.postalCode !== undefined && { postalCode: input.postalCode ?? '' }),
        ...(input.isDefault !== undefined && { isDefault: input.isDefault }),
        ...(input.isBillingAddress !== undefined && { isBillingAddress: input.isBillingAddress }),
        ...(input.invoiceType !== undefined && { invoiceType: input.invoiceType }),
        ...(input.tcNumber !== undefined && { tcNumber: input.tcNumber }),
        ...(input.isForeignNational !== undefined && { isForeignNational: input.isForeignNational }),
        ...(input.companyName !== undefined && { companyName: input.companyName }),
        ...(input.taxOffice !== undefined && { taxOffice: input.taxOffice }),
        ...(input.taxNumber !== undefined && { taxNumber: input.taxNumber }),
      },
    })
  }

  async function deleteAddress(userId: string, addressId: string) {
    const address = await prisma.address.findUnique({ where: { id: addressId } })
    if (!address) throw new NotFoundError('Address', addressId)
    if (address.userId !== userId) throw new ForbiddenError('Bu adres size ait değil.')

    // Check if address is referenced by orders
    const orderCount = await prisma.order.count({ where: { addressId } })
    if (orderCount > 0) {
      throw new ValidationError('Bu adres mevcut siparişlerle ilişkili olduğu için silinemez.')
    }

    await prisma.address.delete({ where: { id: addressId } })
  }

  async function setDefaultAddress(userId: string, addressId: string) {
    const address = await prisma.address.findUnique({ where: { id: addressId } })
    if (!address) throw new NotFoundError('Address', addressId)
    if (address.userId !== userId) throw new ForbiddenError('Bu adres size ait değil.')

    await prisma.$transaction([
      prisma.address.updateMany({
        where: { userId, isDefault: true },
        data: { isDefault: false },
      }),
      prisma.address.update({
        where: { id: addressId },
        data: { isDefault: true },
      }),
    ])
  }

  return {
    getProfile,
    updateProfile,
    listAddresses,
    addAddress,
    updateAddress,
    deleteAddress,
    setDefaultAddress,
  }
}
