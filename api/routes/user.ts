/**
 * User route handlers — customer profile and address management.
 * Thin layer: validate → call service → respond.
 */
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { ok, created, handleError } from '../lib/response'
import { createUserService } from '../services/user.service'
import { createPrismaForRoute } from '../lib/prisma'

const updateProfileSchema = z.object({
  name: z.string().min(2, 'İsim en az 2 karakter olmalıdır').max(100).optional(),
  image: z.string().url('Geçerli bir URL giriniz').optional(),
})

const addressSchema = z.object({
  label: z.string().max(50).optional(),
  fullName: z.string().min(2, 'Ad soyad zorunludur'),
  phone: z
    .string()
    .regex(/^(\+90|0)?[5][0-9]{9}$/, 'Geçerli bir Türkiye telefon numarası girin'),
  addressLine1: z.string().min(5, 'Adres en az 5 karakter olmalıdır'),
  addressLine2: z.string().optional(),
  district: z.string().min(2, 'İlçe zorunludur'),
  city: z.string().min(2, 'Şehir zorunludur'),
  postalCode: z.string().length(5, 'Posta kodu 5 hane olmalıdır'),
  country: z.string().length(2).optional(),
  isDefault: z.boolean().optional(),
})

const updateAddressSchema = addressSchema.partial()

function getUserService() {
  return createUserService({ prisma: createPrismaForRoute() })
}

// GET /api/user/profile
export async function getProfile(userId: string) {
  try {
    const svc = getUserService()
    const profile = await svc.getProfile(userId)
    return ok(profile)
  } catch (err) {
    return handleError(err)
  }
}

// PATCH /api/user/profile
export async function updateProfile(req: NextRequest, userId: string) {
  try {
    const body = updateProfileSchema.parse(await req.json())
    const svc = getUserService()
    const updated = await svc.updateProfile(userId, {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.image !== undefined ? { image: body.image } : {}),
    })
    return ok(updated)
  } catch (err) {
    return handleError(err)
  }
}

// GET /api/user/addresses
export async function listAddresses(userId: string) {
  try {
    const svc = getUserService()
    const addresses = await svc.listAddresses(userId)
    return ok(addresses)
  } catch (err) {
    return handleError(err)
  }
}

// POST /api/user/addresses
export async function addAddress(req: NextRequest, userId: string) {
  try {
    const body = addressSchema.parse(await req.json())
    const svc = getUserService()
    const address = await svc.addAddress(userId, {
      fullName: body.fullName,
      phone: body.phone,
      addressLine1: body.addressLine1,
      district: body.district,
      city: body.city,
      postalCode: body.postalCode,
      ...(body.label !== undefined ? { label: body.label } : {}),
      ...(body.addressLine2 !== undefined ? { addressLine2: body.addressLine2 } : {}),
      ...(body.country !== undefined ? { country: body.country } : {}),
      ...(body.isDefault !== undefined ? { isDefault: body.isDefault } : {}),
    })
    return created(address)
  } catch (err) {
    return handleError(err)
  }
}

// PATCH /api/user/addresses/:id
export async function updateAddress(req: NextRequest, userId: string, addressId: string) {
  try {
    const body = updateAddressSchema.parse(await req.json())
    const svc = getUserService()
    const updated = await svc.updateAddress(userId, addressId, {
      ...(body.label !== undefined ? { label: body.label } : {}),
      ...(body.fullName !== undefined ? { fullName: body.fullName } : {}),
      ...(body.phone !== undefined ? { phone: body.phone } : {}),
      ...(body.addressLine1 !== undefined ? { addressLine1: body.addressLine1 } : {}),
      ...(body.addressLine2 !== undefined ? { addressLine2: body.addressLine2 } : {}),
      ...(body.district !== undefined ? { district: body.district } : {}),
      ...(body.city !== undefined ? { city: body.city } : {}),
      ...(body.postalCode !== undefined ? { postalCode: body.postalCode } : {}),
      ...(body.country !== undefined ? { country: body.country } : {}),
      ...(body.isDefault !== undefined ? { isDefault: body.isDefault } : {}),
    })
    return ok(updated)
  } catch (err) {
    return handleError(err)
  }
}

// DELETE /api/user/addresses/:id
export async function deleteAddress(userId: string, addressId: string) {
  try {
    const svc = getUserService()
    await svc.deleteAddress(userId, addressId)
    return ok({ deleted: true })
  } catch (err) {
    return handleError(err)
  }
}

// POST /api/user/addresses/:id/default
export async function setDefaultAddress(userId: string, addressId: string) {
  try {
    const svc = getUserService()
    await svc.setDefaultAddress(userId, addressId)
    return ok({ success: true })
  } catch (err) {
    return handleError(err)
  }
}
