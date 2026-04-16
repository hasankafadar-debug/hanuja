/**
 * Checkout route handlers — thin: validate → auth → service → respond.
 * Business logic lives in api/services/checkout.service.ts
 *
 * GÜVENLİK: Hiçbir zaman client'tan gelen tutar kabul edilmez.
 * Tüm tutarlar sunucu tarafında hesaplanır.
 */
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { ok, created, handleError } from '../lib/response'
import { createCheckoutService } from '../services/checkout.service'
import { createPrismaForRoute } from '../lib/prisma'

const createOrderSchema = z.object({
  addressId: z.string().min(1, 'Adres seçimi zorunludur'),
  paymentMethod: z.enum(['card', 'eft']),
  couponCode: z.string().optional(),
  notes: z.string().max(500).optional(),
  idempotencyKey: z.string().optional(),
})

const addAddressSchema = z.object({
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
  isDefault: z.boolean().optional(),
})

function getCheckoutService() {
  return createCheckoutService({ prisma: createPrismaForRoute() })
}

// GET /api/checkout/validate — sepet doğrulama
export async function validateCart(userId: string) {
  try {
    const svc = getCheckoutService()
    const result = await svc.validateCart(userId)
    return ok(result)
  } catch (err) {
    return handleError(err)
  }
}

// GET /api/checkout/addresses — kayıtlı adresler
export async function getAddresses(userId: string) {
  try {
    const svc = getCheckoutService()
    const addresses = await svc.getAddresses(userId)
    return ok(addresses)
  } catch (err) {
    return handleError(err)
  }
}

// POST /api/checkout/addresses — yeni adres ekle
export async function addAddress(req: NextRequest, userId: string) {
  try {
    const body = addAddressSchema.parse(await req.json())
    const svc = getCheckoutService()
    const address = await svc.addAddress(userId, {
      fullName: body.fullName,
      phone: body.phone,
      addressLine1: body.addressLine1,
      district: body.district,
      city: body.city,
      postalCode: body.postalCode,
      ...(body.label !== undefined ? { label: body.label } : {}),
      ...(body.addressLine2 !== undefined ? { addressLine2: body.addressLine2 } : {}),
      ...(body.isDefault !== undefined ? { isDefault: body.isDefault } : {}),
    })
    return created(address)
  } catch (err) {
    return handleError(err)
  }
}

// POST /api/checkout/order — sipariş oluştur
export async function createOrder(req: NextRequest, userId: string) {
  try {
    const body = createOrderSchema.parse(await req.json())
    const svc = getCheckoutService()
    const result = await svc.createOrder({
      userId,
      addressId: body.addressId,
      paymentMethod: body.paymentMethod,
      ...(body.couponCode !== undefined ? { couponCode: body.couponCode } : {}),
      ...(body.notes !== undefined ? { notes: body.notes } : {}),
      ...(body.idempotencyKey !== undefined ? { idempotencyKey: body.idempotencyKey } : {}),
    })
    return created(result)
  } catch (err) {
    return handleError(err)
  }
}

// POST /api/checkout/clear-cart — sipariş sonrası sepeti temizle
export async function clearCartAfterOrder(userId: string) {
  try {
    const svc = getCheckoutService()
    await svc.clearCartAfterOrder(userId)
    return ok({ cleared: true })
  } catch (err) {
    return handleError(err)
  }
}
