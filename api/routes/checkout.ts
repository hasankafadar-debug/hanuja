import { NextRequest } from 'next/server'
import { z } from 'zod'
import { buildLegalAcceptanceEvidence } from '../lib/legal-acceptance'
import { createPrismaForRoute } from '../lib/prisma'
import { created, handleError, ok } from '../lib/response'
import { createCheckoutService } from '../services/checkout.service'

export const createOrderSchema = z.object({
  addressId: z.string().min(1, 'Adres secimi zorunludur'),
  billingAddressId: z.string().cuid().optional(),
  paymentMethod: z.enum(['card', 'eft']),
  couponCode: z.string().optional(),
  notes: z.string().max(500).optional(),
  idempotencyKey: z.string().optional(),
  turnstileToken: z.string().min(1, 'Insan dogrulamasi zorunludur'),
  acceptedDistanceSales: z.literal(true, {
    errorMap: () => ({ message: 'Mesafeli satis sozlesmesini kabul etmeniz zorunludur' }),
  }),
  acceptedPreInformation: z.literal(true, {
    errorMap: () => ({ message: 'On bilgilendirme formunu kabul etmeniz zorunludur' }),
  }),
})

export type CreateOrderInput = z.infer<typeof createOrderSchema>

const contractsPreviewSchema = z.object({
  addressId: z.string().min(1, 'Adres secimi zorunludur'),
  paymentMethod: z.enum(['card', 'eft']).default('card'),
})

const addAddressSchema = z
  .object({
    label: z.string().max(50).optional(),
    fullName: z.string().min(2, 'Ad soyad zorunludur'),
    phone: z.string().regex(/^(\+90|0)?[5][0-9]{9}$/, 'Gecerli bir Turkiye telefon numarasi girin'),
    addressLine1: z.string().min(5, 'Adres en az 5 karakter olmali'),
    addressLine2: z.string().optional(),
    district: z.string().min(2, 'Ilce zorunludur'),
    city: z.string().min(2, 'Sehir zorunludur'),
    postalCode: z.string().regex(/^\d{5}$/, 'Posta kodu 5 hane olmali').optional().or(z.literal('')),
    isDefault: z.boolean().optional(),
    // Fatura adresi alanları
    isBillingAddress: z.boolean().optional(),
    invoiceType: z.enum(['individual', 'corporate']).optional(),
    tcNumber: z.string().max(11).optional(),
    isForeignNational: z.boolean().optional(),
    companyName: z.string().max(200).optional(),
    taxOffice: z.string().max(100).optional(),
    taxNumber: z.string().max(20).optional(),
  })
  .superRefine((data, ctx) => {
    if (!data.isBillingAddress) return
    if (data.invoiceType === 'individual' && !data.isForeignNational && !data.tcNumber) {
      ctx.addIssue({ code: 'custom', path: ['tcNumber'], message: 'TC Kimlik No zorunludur' })
    }
    if (data.invoiceType === 'corporate') {
      if (!data.companyName) ctx.addIssue({ code: 'custom', path: ['companyName'], message: 'Unvan zorunludur' })
      if (!data.taxOffice) ctx.addIssue({ code: 'custom', path: ['taxOffice'], message: 'Vergi dairesi zorunludur' })
      if (!data.taxNumber) ctx.addIssue({ code: 'custom', path: ['taxNumber'], message: 'Vergi numarasi zorunludur' })
    }
  })

function getCheckoutService() {
  return createCheckoutService({ prisma: createPrismaForRoute() })
}

export async function validateCart(userId: string) {
  try {
    const svc = getCheckoutService()
    const result = await svc.validateCart(userId)
    return ok(result)
  } catch (error) {
    return handleError(error)
  }
}

export async function getAddresses(userId: string) {
  try {
    const svc = getCheckoutService()
    const addresses = await svc.getAddresses(userId)
    return ok(addresses)
  } catch (error) {
    return handleError(error)
  }
}

export async function getContractsPreview(req: NextRequest, userId: string) {
  try {
    const query = contractsPreviewSchema.parse({
      addressId: req.nextUrl.searchParams.get('addressId'),
      paymentMethod: req.nextUrl.searchParams.get('paymentMethod') ?? 'card',
    })

    const svc = getCheckoutService()
    const contracts = await svc.previewLegalDocuments({
      userId,
      addressId: query.addressId,
      paymentMethod: query.paymentMethod,
    })

    return ok(contracts)
  } catch (error) {
    return handleError(error)
  }
}

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
      postalCode: body.postalCode ?? '',
      ...(body.label !== undefined ? { label: body.label } : {}),
      ...(body.addressLine2 !== undefined ? { addressLine2: body.addressLine2 } : {}),
      ...(body.isDefault !== undefined ? { isDefault: body.isDefault } : {}),
      ...(body.isBillingAddress !== undefined ? { isBillingAddress: body.isBillingAddress } : {}),
      ...(body.invoiceType !== undefined ? { invoiceType: body.invoiceType } : {}),
      ...(body.tcNumber !== undefined ? { tcNumber: body.tcNumber } : {}),
      ...(body.isForeignNational !== undefined ? { isForeignNational: body.isForeignNational } : {}),
      ...(body.companyName !== undefined ? { companyName: body.companyName } : {}),
      ...(body.taxOffice !== undefined ? { taxOffice: body.taxOffice } : {}),
      ...(body.taxNumber !== undefined ? { taxNumber: body.taxNumber } : {}),
    })

    return created(address)
  } catch (error) {
    return handleError(error)
  }
}

export async function createOrder(req: NextRequest, userId: string, bodyOverride?: CreateOrderInput) {
  try {
    const body = bodyOverride ?? createOrderSchema.parse(await req.json())
    const prisma = createPrismaForRoute()
    const legalAcceptance = await buildLegalAcceptanceEvidence({ prisma, req, userId })
    const svc = createCheckoutService({ prisma })
    const result = await svc.createOrder({
      userId,
      addressId: body.addressId,
      paymentMethod: body.paymentMethod,
      ...(body.billingAddressId !== undefined ? { billingAddressId: body.billingAddressId } : {}),
      ...(body.couponCode !== undefined ? { couponCode: body.couponCode } : {}),
      ...(body.notes !== undefined ? { notes: body.notes } : {}),
      ...(body.idempotencyKey !== undefined ? { idempotencyKey: body.idempotencyKey } : {}),
      legalAcceptance,
    })

    return created(result)
  } catch (error) {
    return handleError(error)
  }
}

export async function clearCartAfterOrder(userId: string) {
  try {
    const svc = getCheckoutService()
    await svc.clearCartAfterOrder(userId)
    return ok({ cleared: true })
  } catch (error) {
    return handleError(error)
  }
}
