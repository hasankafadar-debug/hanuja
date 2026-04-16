/**
 * Common input validation schemas and safe parse helpers.
 * All external input (user forms, API bodies, query params) must go through
 * schema validation before touching business logic.
 */
import { z } from 'zod'

// ── Primitive schemas ─────────────────────────────────────────────────────────

export const slugSchema = z
  .string()
  .min(2)
  .max(200)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Geçersiz slug formatı')

export const ibanSchema = z
  .string()
  .regex(/^TR\d{24}$/, "IBAN TR ile başlamalı ve 26 karakter olmalı")

export const phoneSchema = z
  .string()
  .regex(/^(\+90|0)?\s*5\d{2}[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}$/, 'Geçersiz telefon numarası')

export const turkishIdSchema = z
  .string()
  .length(11)
  .regex(/^\d{11}$/, 'TC kimlik numarası 11 haneli olmalı')

export const priceSchema = z
  .number()
  .positive('Fiyat pozitif olmalı')
  .max(1_000_000, 'Fiyat çok yüksek')

export const quantitySchema = z
  .number()
  .int()
  .min(1, 'Adet en az 1 olmalı')
  .max(9999)

export const paginationSchema = z.object({
  skip: z.coerce.number().int().min(0).default(0),
  take: z.coerce.number().int().min(1).max(100).default(20),
})

// ── Auth schemas ──────────────────────────────────────────────────────────────

export const emailSchema = z
  .string()
  .email('Geçersiz e-posta adresi')
  .max(254)
  .toLowerCase()

export const passwordSchema = z
  .string()
  .min(8, 'Şifre en az 8 karakter olmalı')
  .max(128)

export const loginSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
})

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: z.string().min(2).max(100),
})

// ── Order / checkout schemas ──────────────────────────────────────────────────

export const cartItemSchema = z.object({
  productId: z.string().cuid(),
  variantId: z.string().cuid().optional(),
  quantity: quantitySchema,
})

export const addressSchema = z.object({
  fullName: z.string().min(3).max(100),
  phone: phoneSchema,
  addressLine: z.string().min(5).max(250),
  city: z.string().min(2).max(80),
  district: z.string().min(2).max(80),
  postalCode: z.string().regex(/^\d{5}$/, '5 haneli posta kodu gerekli').optional(),
})

export const checkoutSchema = z.object({
  addressId: z.string().cuid().optional(),
  newAddress: addressSchema.optional(),
  couponCode: z.string().max(50).optional(),
  paymentMethod: z.enum(['card', 'eft']),
}).refine((d) => d.addressId ?? d.newAddress, {
  message: 'Teslimat adresi seçilmeli veya girilmeli',
})

// ── Seller schemas ────────────────────────────────────────────────────────────

export const sellerBankDetailSchema = z.object({
  iban: ibanSchema,
  accountHolderName: z.string().min(3).max(100),
  bankName: z.string().min(2).max(100),
})

export const productCreateSchema = z.object({
  title: z.string().min(5).max(200),
  description: z.string().min(20).max(10_000),
  price: priceSchema,
  comparePrice: priceSchema.optional(),
  stock: quantitySchema,
  categoryId: z.string().cuid(),
  sku: z.string().max(100).optional(),
})

export const shipmentEntrySchema = z.object({
  trackingCode: z.string().min(5).max(100),
  cargoProvider: z.string().min(2).max(80),
})

export const sellerRejectionSchema = z.object({
  reason: z.string().min(10).max(500),
  reasonCode: z.enum([
    'stock_error',
    'price_error',
    'production_impossible',
    'quality_problem',
    'force_majeure',
    'other',
  ]),
})

// ── Admin schemas ─────────────────────────────────────────────────────────────

export const eftApprovalSchema = z.object({
  evidenceNote: z.string().max(500).optional(),
})

export const eftRejectionSchema = z.object({
  reason: z.string().min(5).max(500),
})

export const penaltyWaiverSchema = z.object({
  reason: z.string().min(10).max(1000),
  approvedBy: z.string().min(2).max(100),
})

// ── Return / dispute schemas ──────────────────────────────────────────────────

export const returnRequestSchema = z.object({
  reason: z.string().min(10).max(1000),
  reasonCode: z.enum([
    'wrong_item',
    'damaged',
    'not_as_described',
    'changed_mind',
    'defective',
    'other',
  ]),
})

// ── Safe parse helper ─────────────────────────────────────────────────────────

export interface ParseResult<T> {
  success: true
  data: T
}

export interface ParseError {
  success: false
  errors: { field: string; message: string }[]
}

export function safeParse<T>(
  schema: z.ZodSchema<T>,
  input: unknown,
): ParseResult<T> | ParseError {
  const result = schema.safeParse(input)
  if (result.success) {
    return { success: true, data: result.data }
  }
  return {
    success: false,
    errors: result.error.issues.map((issue) => ({
      field: issue.path.join('.') || 'root',
      message: issue.message,
    })),
  }
}
