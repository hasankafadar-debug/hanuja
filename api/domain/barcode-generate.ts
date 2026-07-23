import type { PrismaClient } from '@prisma/client'
import { randomInt } from 'node:crypto'
import { ConflictError, ValidationError } from '../lib/errors'

type BarcodeRegistryReader = Pick<PrismaClient, 'barcodeRegistry'>

/**
 * Auto-generated barcodes use the leading digit "8" so they are visually
 * distinguishable and stay inside a 13-digit EAN-13 shape. They are internal
 * (not GS1-assigned); global uniqueness is guaranteed by the barcode registry.
 */
const AUTO_BARCODE_PREFIX = '8'
const MAX_GENERATION_ATTEMPTS = 50

/** Standard EAN-13 check digit for the leading 12 digits. */
export function computeEan13CheckDigit(twelveDigits: string): string {
  if (!/^\d{12}$/.test(twelveDigits)) {
    throw new ValidationError('EAN-13 gövdesi 12 haneli rakam olmalıdır.')
  }

  let sum = 0
  for (let i = 0; i < 12; i += 1) {
    const digit = twelveDigits.charCodeAt(i) - 48
    // Positions are 1-indexed: odd positions ×1, even positions ×3.
    sum += i % 2 === 0 ? digit : digit * 3
  }

  return String((10 - (sum % 10)) % 10)
}

function buildCandidateBarcode(): string {
  let body = AUTO_BARCODE_PREFIX
  for (let i = 0; i < 11; i += 1) {
    body += String(randomInt(0, 10))
  }
  return body + computeEan13CheckDigit(body)
}

/**
 * Generates a globally-unique 13-digit barcode starting with "8".
 *
 * Checks the barcode registry (the single source of truth for product and
 * variant barcodes) plus an optional in-request `used` set so a batch that
 * generates several codes in one transaction cannot collide with itself.
 * The DB unique constraint / registry trigger remains the final guard.
 */
export async function generateUniqueProductBarcode(
  client: BarcodeRegistryReader,
  opts?: { used?: Set<string> },
): Promise<string> {
  const used = opts?.used

  for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt += 1) {
    const barcode = buildCandidateBarcode()
    if (used?.has(barcode)) continue

    const existing = await client.barcodeRegistry.findUnique({
      where: { barcode },
      select: { barcode: true },
    })
    if (existing) continue

    used?.add(barcode)
    return barcode
  }

  throw new ConflictError('Benzersiz barkod üretilemedi. Lütfen tekrar deneyin.')
}
