import { z } from 'zod'

export const MAX_BULK_UPDATE_ROWS = 500

const optionalNumber = z.number().nonnegative().optional()

const bulkUpdateRowSchema = z.object({
  identifier: z.string().trim().regex(/^\d{13}$/, 'Barkod 13 haneli rakam olmali'),
  newPrice: optionalNumber,
  newStock: z.number().int('Stok tam sayi olmali').min(0, 'Stok negatif olamaz').optional(),
})

export interface BulkProductUpdateRow {
  identifier: string
  newPrice?: number
  newStock?: number
}

export interface BulkProductUpdateRowResult {
  rowNumber: number
  raw: Record<string, unknown>
  data?: BulkProductUpdateRow
  errors: string[]
}

function parseOptionalNumber(value: unknown) {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value === 'number') return Number.isFinite(value) ? value : Number.NaN
  const parsed = Number(String(value).trim().replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : Number.NaN
}

function normalizeHeader(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

const UPDATE_HEADER_MAP = new Map<string, keyof BulkProductUpdateRow>([
  ['barkod*', 'identifier'],
  ['barkod', 'identifier'],
  ['identifier', 'identifier'],
  ['yeni fiyat', 'newPrice'],
  ['new price', 'newPrice'],
  ['newprice', 'newPrice'],
  ['yeni stok', 'newStock'],
  ['new stock', 'newStock'],
  ['newstock', 'newStock'],
])

export const BULK_UPDATE_TEMPLATE_HEADERS = ['Barkod*', 'Yeni Fiyat', 'Yeni Stok'] as const

export const BULK_UPDATE_TEMPLATE_SAMPLE_ROW = {
  identifier: '8691234567890',
  newPrice: 4290,
  newStock: 12,
}

export function normalizeBulkProductUpdateRow(
  raw: Record<string, unknown>,
  rowNumber: number,
): BulkProductUpdateRowResult {
  const mapped: Partial<Record<keyof BulkProductUpdateRow, unknown>> = {}

  for (const [key, value] of Object.entries(raw)) {
    const normalizedKey = UPDATE_HEADER_MAP.get(normalizeHeader(key))
    if (normalizedKey) mapped[normalizedKey] = value
  }

  const prepared = {
    identifier: String(mapped.identifier ?? '').trim(),
    newPrice: parseOptionalNumber(mapped.newPrice),
    newStock: parseOptionalNumber(mapped.newStock),
  }

  const parsed = bulkUpdateRowSchema
    .superRefine((data, ctx) => {
      if (data.newPrice === undefined && data.newStock === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Yeni fiyat veya yeni stok alanlarindan en az biri girilmelidir',
          path: ['identifier'],
        })
      }
    })
    .safeParse(prepared)

  if (!parsed.success) {
    return {
      rowNumber,
      raw,
      errors: parsed.error.issues.map((issue) => issue.message),
    }
  }

  return {
    rowNumber,
    raw,
    data: {
      identifier: parsed.data.identifier,
      ...(parsed.data.newPrice !== undefined ? { newPrice: parsed.data.newPrice } : {}),
      ...(parsed.data.newStock !== undefined ? { newStock: parsed.data.newStock } : {}),
    },
    errors: [],
  }
}
